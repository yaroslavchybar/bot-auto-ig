import { expect, test } from 'bun:test'
import { preflightQuery } from './check-simplification'

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
const check = (rows: Record<string, unknown[]>) =>
  new AsyncFunction('ctx', preflightQuery)({
    db: {
      query: (table: string) => ({
        take: async (limit: number) => (rows[table] ?? []).slice(0, limit),
      }),
    },
  })

test('preflight permits inactive legacy data and returns no private profile fields', async () => {
  expect(
    await check({ profiles: [{ modelIds: ['model'], cookiesJson: 'private', inUse: false }] }),
  ).toEqual({ ready: true, migrationPending: true })
})

test('preflight stops before deployment when legacy data has an active owner', async () => {
  await expect(
    check({ profiles: [{ modelIds: ['model'] }], automations: [{ isActive: true }] }),
  ).rejects.toThrow('Disable automations and stop profiles')
  await expect(check({ profiles: [{ modelIds: ['model'], inUse: true }] })).rejects.toThrow(
    'Disable automations and stop profiles',
  )
})

test('completed migration does not block later deployments while profiles are running', async () => {
  expect(
    await check({
      profiles: [{ modelId: 'model', inUse: true }],
      automations: [{ isActive: true, routine: { outreach: {} } }],
    }),
  ).toEqual({ ready: true, migrationPending: false })
})

test('preflight rejects a capped read rather than treating a partial inventory as safe', async () => {
  await expect(check({ profiles: Array.from({ length: 1001 }, () => ({})) })).rejects.toThrow(
    'exceeds 1,000 profiles',
  )
})

test('preflight rejects incompatible saved data before publishing functions', async () => {
  await expect(check({ automations: [{ nodes: [] }] })).rejects.toThrow('Retire graph automations')
  await expect(check({ automations: [{ routine: { outreachRoutes: [{}, {}] } }] })).rejects.toThrow(
    'Correct multiple outreach assignments',
  )
  await expect(check({ profiles: [{ _id: 'p', modelIds: ['one', 'two'] }] })).rejects.toThrow(
    'Correct conflicting profile memberships',
  )
})

test('preflight requires scraping to stop only while old analytics still needs initialization', async () => {
  const rows = { profiles: [{ modelIds: [] }], scrapeSources: [{ enabled: true }] }
  await expect(check(rows)).rejects.toThrow('Pause scraping')
  expect(await check({ ...rows, analyticsHistory: [{}] })).toEqual({
    ready: true,
    migrationPending: true,
  })
})

test('analytics-only backfill is pending and requires inactive profile owners', async () => {
  const rows = { analyticsDays: [{ date: '2026-10-24' }] }
  expect(await check(rows)).toEqual({ ready: true, migrationPending: true })
  await expect(check({ ...rows, profiles: [{ modelId: 'model', inUse: true }] })).rejects.toThrow(
    'Disable automations and stop profiles',
  )
})

test.each(['enabled', 'running'])(
  'analytics-only backfill blocks %s scraping until history exists',
  async (flag) => {
    const rows = { analyticsDays: [{ date: '2026-10-24' }], scrapeSources: [{ [flag]: true }] }
    await expect(check(rows)).rejects.toThrow('Pause scraping')
    expect(await check({ ...rows, analyticsHistory: [{}] })).toEqual({
      ready: true,
      migrationPending: false,
    })
  },
)
