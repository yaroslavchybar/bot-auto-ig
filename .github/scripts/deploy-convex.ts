import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import {
  cleanupTables,
  compatibilitySchema,
  maintenanceModule,
  migrationModule,
} from './schema-cleanup'

function convex(args: string[], quiet = false) {
  const result = spawnSync('bunx', ['convex', ...args], {
    encoding: 'utf8',
    stdio: quiet ? 'pipe' : 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(quiet ? `${result.stdout}\n${result.stderr}` : 'Convex command failed')
  return result.stdout
}
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? ['_generated', 'tests'].includes(entry.name)
        ? []
        : sourceFiles(join(directory, entry.name))
      : entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')
        ? [join(directory, entry.name)]
        : [],
  )
}
function pages(run: typeof convex, endpoint: string, table?: string) {
  let cursor: string | null = null
  while (true) {
    const result = JSON.parse(
      run(
        ['run', '--prod', endpoint, JSON.stringify({ ...(table ? { table } : {}), cursor })],
        true,
      ),
    ) as { done: boolean; cursor: string }
    if (
      typeof result.done !== 'boolean' ||
      typeof result.cursor !== 'string' ||
      (!result.done && result.cursor === cursor)
    )
      throw new Error('Invalid migration page')
    if (result.done) return
    cursor = result.cursor
  }
}

/** One maintenance deployment migrates both field names and model references before activation. */
export function deploy(run = convex, directory = process.cwd()) {
  const deployArgs = ['deploy', '--check-build-environment', 'disable']
  try {
    run(deployArgs, true)
    const pending = JSON.parse(
      run(
        [
          'run',
          '--prod',
          '--inline-query',
          'Boolean(await ctx.db.query("lists").first() || await ctx.db.query("profileListAssignments").first() || await ctx.db.query("messageTemplates").first() || await ctx.db.query("schemaCleanupState").first())',
        ],
        true,
      ),
    ) as boolean
    if (!pending) {
      console.log('Convex deployed.')
      return
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/schema|validator/i.test(message)) throw error
  }

  const root = join(directory, 'convex')
  const migration = join(root, 'schemaCleanup.ts')
  const facade = join(root, 'schemaMigrationServer.js')
  const declaration = join(root, 'schemaMigrationServer.d.ts')
  for (const file of [migration, facade, declaration])
    if (existsSync(file)) throw new Error('Temporary migration file already exists')
  const originals = new Map(sourceFiles(root).map((file) => [file, readFileSync(file, 'utf8')]))
  const restore = () => {
    for (const [file, text] of originals) writeFileSync(file, text)
    for (const file of [facade, declaration]) if (existsSync(file)) unlinkSync(file)
  }
  try {
    console.log('Entering database maintenance for schema cleanup.')
    for (const [file, text] of originals) {
      const content =
        file === join(root, 'schema.ts')
          ? compatibilitySchema(text)
          : text.replace(/(['"])((?:\.\.?\/)+)_generated\/server\1/g, '$1$2schemaMigrationServer$1')
      writeFileSync(file, content)
    }
    writeFileSync(facade, maintenanceModule, { flag: 'wx' })
    writeFileSync(declaration, "export * from './_generated/server'\n", { flag: 'wx' })
    writeFileSync(migration, migrationModule, { flag: 'wx' })
    // Bridge row shapes are intentionally permissive; final deployment typechecks the strict schema.
    run([...deployArgs, '--typecheck', 'disable'])
    for (const table of cleanupTables) {
      pages(run, 'schemaCleanup:batch', table)
      console.log(`Cleaned ${table}.`)
    }
    restore()
    // Activate normal app handlers before replacing expiration jobs consumed during maintenance.
    run(deployArgs)
    pages(run, 'schemaCleanup:expiry')
  } finally {
    restore()
    if (existsSync(migration)) unlinkSync(migration)
  }
  run(deployArgs)
}

if (import.meta.main) deploy()
