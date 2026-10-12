import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

/** Accept old documents only until the migration removes their retired fields. */
export function compatibleSchema(source: string) {
  const insert = (text: string, anchor: string, addition: string) => {
    if (text.split(anchor).length !== 2)
      throw new Error(`Missing or ambiguous schema anchor: ${anchor}`)
    return text.replace(anchor, anchor + addition)
  }
  let result = insert(
    source.replace(/\r\n/g, '\n'),
    'leads: defineTable({',
    `
    profilePicUrl: v.optional(v.string()),
    profilePicDescription: v.optional(v.string()),
    pictureBatchId: v.optional(v.string()),`,
  )
  result = insert(
    result,
    '    enrichmentStatus: v.optional(\n      v.union(',
    "\n        v.literal('describing'),",
  )
  const anchor = '  leadScreeningMigration: defineTable({'
  if (result.split(anchor).length !== 2) throw new Error('Missing or ambiguous migration table')
  return result.replace(
    anchor,
    `  enrichmentWork: defineTable({ pending: v.boolean() }),\n${anchor}`,
  )
}

type MigrationStatus = { complete: boolean; processed?: number; reset?: number; cleaned?: number }
type Runner = (args: string[]) => string

/** Failed deployments retain the compatible schema; retries resume the saved migration cursor. */
export async function deployConvex(options: {
  run: Runner
  readSchema: () => string
  writeSchema: (source: string) => void
  wait: () => Promise<void>
  now: () => number
}) {
  const { run } = options
  const deploy = ['deploy', '--check-build-environment', 'disable', '--codegen', 'disable']
  const state = JSON.parse(
    run([
      'run',
      '--prod',
      '--inline-query',
      'return await ctx.db.query("leadScreeningMigration").unique();',
    ]),
  ) as MigrationStatus | null
  if (state?.complete) {
    run(deploy)
    return state
  }
  const schema = options.readSchema()
  try {
    options.writeSchema(compatibleSchema(schema))
    run(deploy)
    run(['run', '--prod', 'migrations/leadScreening:start', '{}'])
    const deadline = options.now() + 5 * 60_000
    while (options.now() < deadline) {
      const status = JSON.parse(
        run(['run', '--prod', 'migrations/leadScreening:migrationStatus', '{}']),
      ) as MigrationStatus | null
      if (status?.complete) {
        options.writeSchema(schema)
        run(deploy)
        return status
      }
      run(['run', '--prod', 'migrations/leadScreening:start', '{}'])
      await options.wait()
    }
    throw new Error('Lead migration did not finish; retaining the compatible deployed schema')
  } finally {
    options.writeSchema(schema)
  }
}

if (import.meta.main) {
  const result = await deployConvex({
    run(args) {
      const result = spawnSync('bunx', ['convex', ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
      })
      if (result.error) throw result.error
      if (result.status !== 0) throw new Error(`Convex ${args[0]} failed`)
      return result.stdout
    },
    readSchema: () => readFileSync('convex/schema.ts', 'utf8'),
    writeSchema: (source) => writeFileSync('convex/schema.ts', source),
    wait: () => new Promise((resolve) => setTimeout(resolve, 2000)),
    now: Date.now,
  })
  console.log(
    `Lead migration complete: ${result.processed ?? 0} checked, ${result.reset ?? 0} reset, ${result.cleaned ?? 0} cleaned`,
  )
}
