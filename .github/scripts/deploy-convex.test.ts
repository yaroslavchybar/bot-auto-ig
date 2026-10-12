import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { compatibleSchema, deployConvex } from './deploy-convex'

const original = readFileSync('convex/schema.ts', 'utf8')

function fixture(
  options: {
    completed?: boolean
    fail?: boolean
    stalled?: boolean
    initialOutput?: string
    missingPoll?: boolean
  } = {},
) {
  let source = original,
    time = 0,
    polls = 0
  const deployed: string[] = []
  const calls: string[][] = []
  const settings = {
    readSchema: () => source,
    writeSchema: (value: string) => {
      source = value
    },
    now: () => time,
    wait: async () => {
      time += 60_000
    },
    run(args: string[]) {
      calls.push(args)
      if (args[0] === 'deploy') {
        deployed.push(source)
        if (options.fail) throw new Error('Deployment failed')
        return ''
      }
      if (args.includes('--inline-query'))
        return options.completed ? '{"complete":true}' : (options.initialOutput ?? '')
      if (args.includes('migrations/leadScreening:migrationStatus')) {
        if (polls++ === 0 && options.missingPoll) return ' \n'
        return JSON.stringify({
          complete: !options.stalled,
          processed: 2842,
          reset: 2840,
          cleaned: 2842,
        })
      }
      return 'null'
    },
  }
  return { settings, deployed, calls, source: () => source }
}

test('deploy accepts old data, runs migration, and only then removes the retired schema fields', async () => {
  const f = fixture()
  expect(await deployConvex(f.settings)).toMatchObject({ complete: true, reset: 2840 })
  expect(f.deployed).toHaveLength(2)
  expect(f.deployed[0]).toContain('profilePicDescription: v.optional(v.string())')
  expect(f.deployed[0]).toContain("v.literal('describing')")
  expect(f.deployed[0]).toContain('enrichmentWork: defineTable')
  expect(f.deployed[1]).toBe(original)
  expect(f.deployed[1]).not.toContain('profilePicDescription')
  expect(f.source()).toBe(original)
  expect(
    f.calls.findIndex((call) => call.includes('migrations/leadScreening:migrationStatus')),
  ).toBeLessThan(f.calls.findLastIndex((call) => call[0] === 'deploy'))
})

test('completed migrations use a single strict-schema deploy', async () => {
  const f = fixture({ completed: true })
  await deployConvex(f.settings)
  expect(f.deployed).toEqual([original])
  expect(f.calls.some((call) => call.includes('migrations/leadScreening:start'))).toBe(false)
})

test.each(['', ' \r\n ', 'null'])(
  'missing migration state from CLI output %j starts cleanup',
  async (initialOutput) => {
    const f = fixture({ initialOutput })
    expect(await deployConvex(f.settings)).toMatchObject({ complete: true })
    expect(f.deployed).toEqual([compatibleSchema(original), original])
    expect(f.source()).toBe(original)
  },
)

test('empty status output during polling waits for migration completion', async () => {
  const f = fixture({ missingPoll: true })
  expect(await deployConvex(f.settings)).toMatchObject({ complete: true })
  expect(
    f.calls.filter((call) => call.includes('migrations/leadScreening:migrationStatus')),
  ).toHaveLength(2)
  expect(f.deployed).toEqual([compatibleSchema(original), original])
})

test('malformed CLI output stops deployment', async () => {
  const f = fixture({ initialOutput: 'invalid json' })
  await expect(deployConvex(f.settings)).rejects.toThrow()
  expect(f.deployed).toHaveLength(0)
  expect(f.source()).toBe(original)
})

test.each([{ fail: true }, { stalled: true }])(
  'failed cleanup never deploys the strict schema and restores the local file: %j',
  async (options) => {
    const f = fixture(options)
    await expect(deployConvex(f.settings)).rejects.toThrow()
    expect(f.deployed).toHaveLength(1)
    expect(f.deployed[0]).toContain('profilePicDescription')
    expect(f.source()).toBe(original)
  },
)

test('schema changes must not silently bypass compatibility', () => {
  expect(() => compatibleSchema('export default schema')).toThrow()
})
