import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { deploy } from './deploy-convex'
import { cleanupTables, maintenanceModule } from './schema-cleanup'

const roots: string[] = []
function fixture() {
  mkdirSync('.codex_tmp', { recursive: true })
  const root = mkdtempSync(join(process.cwd(), '.codex_tmp/schema-deploy-test-'))
  roots.push(root)
  mkdirSync(join(root, 'convex'))
  for (const file of ['schema.ts', 'routines.ts', 'analytics.ts'])
    writeFileSync(join(root, 'convex', file), readFileSync(join('convex', file)))
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!root.startsWith(join(process.cwd(), '.codex_tmp', 'schema-deploy-test-')))
      throw new Error('Unexpected temporary path')
    rmSync(root, { recursive: true })
  }
})

test('normal deployment does not run migration', () => {
  const calls: string[][] = []
  deploy((args) => {
    calls.push(args)
    return 'false'
  })
  expect(calls).toHaveLength(2)
  expect(calls[0]![0]).toBe('deploy')
  expect(calls[1]).toContain('--inline-query')
})

test('existing data is migrated before final schema and temporary files are restored', () => {
  const root = fixture()
  let deployments = 0
  const migrated: string[] = []
  deploy((args) => {
    if (args[0] === 'deploy') {
      deployments++
      if (deployments === 1) throw new Error('schema contains extra field outreachDays')
      if (deployments === 2) {
        expect(readFileSync(join(root, 'convex/schema.ts'), 'utf8')).toContain(
          'lists: defineTable(v.any())',
        )
        expect(readFileSync(join(root, 'convex/routines.ts'), 'utf8')).toContain(
          'schemaMigrationServer',
        )
        expect(existsSync(join(root, 'convex/schemaCleanup.ts'))).toBe(true)
      } else {
        expect(readFileSync(join(root, 'convex/schema.ts'), 'utf8')).not.toContain(
          'followIncrease:',
        )
        expect(existsSync(join(root, 'convex/schemaCleanup.ts'))).toBe(deployments === 3)
      }
      return ''
    }
    const { table, cursor } = JSON.parse(args.at(-1)!) as { table: string; cursor: string | null }
    if (cursor === null) return JSON.stringify({ done: false, cursor: 'page-2' })
    if (table) migrated.push(table)
    return JSON.stringify({ done: true, cursor: '' })
  }, root)
  expect(deployments).toBe(4)
  expect(migrated).toEqual(cleanupTables)
})

test('an interrupted migration fails deployment and restores local sources', () => {
  const root = fixture()
  let deployments = 0
  expect(() =>
    deploy((args) => {
      if (args[0] === 'deploy') {
        if (++deployments === 1) throw new Error('schema contains extra field followIncrease')
        return ''
      }
      throw new Error('Connection lost')
    }, root),
  ).toThrow('Connection lost')
  expect(deployments).toBe(2)
  expect(existsSync(join(root, 'convex/schemaCleanup.ts'))).toBe(false)
  for (const file of ['schema.ts', 'routines.ts', 'analytics.ts'])
    expect(readFileSync(join(root, 'convex', file), 'utf8')).toBe(
      readFileSync(join('convex', file), 'utf8'),
    )
})

test('unrelated deploy errors do not trigger data cleanup', () => {
  let calls = 0
  expect(() =>
    deploy(() => {
      calls++
      throw new Error('Unauthorized')
    }),
  ).toThrow('Unauthorized')
  expect(calls).toBe(1)
})

test('maintenance registrations block every handler without executing application code', async () => {
  const root = fixture()
  const facade = join(root, 'convex/schemaMigrationServer.mjs')
  writeFileSync(facade, maintenanceModule)
  const registration = await import(pathToFileURL(facade).href)
  let called = false
  const handler = () => {
    called = true
  }
  for (const kind of [
    'query',
    'internalQuery',
    'mutation',
    'internalMutation',
    'action',
    'internalAction',
  ]) {
    const fn = registration[kind]({ args: {}, handler })
    await expect(fn._handler({}, {})).rejects.toThrow('Database migration in progress')
  }
  await expect(
    registration.httpAction(handler)._handler({}, new Request('https://example.test')),
  ).rejects.toThrow('Database migration in progress')
  expect(called).toBe(false)
})

test('a remaining migration marker resumes cleanup after strict deployment succeeds', () => {
  const root = fixture()
  let deployments = 0
  let expiry = false
  deploy((args) => {
    if (args[0] === 'deploy') {
      deployments++
      return ''
    }
    if (args.includes('--inline-query')) return 'true'
    if (args.includes('schemaCleanup:expiry')) expiry = true
    return JSON.stringify({ done: true, cursor: '' })
  }, root)
  expect(deployments).toBe(4)
  expect(expiry).toBe(true)
  expect(existsSync(join(root, 'convex/schemaCleanup.ts'))).toBe(false)
})
