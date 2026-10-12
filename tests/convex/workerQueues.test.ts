import { afterEach, expect, test, vi } from 'vite-plus/test'
import { api } from '../../convex/_generated/api'
import { createConvexTest } from './helpers'
import { patchProfile, syncWorkerProfile } from '../../convex/workerMetadata'
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

test.each([10, undefined])(
  'scraper ignores old lead limits and exposes cooldown and lease expiry with old limit %s',
  async (limit) => {
    vi.stubEnv('INTERNAL_API_KEY', 'test-bridge')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))
    const t = createConvexTest()
    const args = { bridgeToken: 'test-bridge' }
    expect(await t.query(api.scraper.work, args)).toEqual({
      taskAt: null,
      blockedProfileIds: [],
      taskKey: null,
    })
    await expect(t.query(api.scraper.work, { bridgeToken: 'wrong' })).rejects.toThrow(
      'Unauthorized',
    )
    const ids = await t.run(async (ctx) => {
      const profile = await ctx.db.insert('profiles', {
        name: 'test',
        proxy: 'proxy.test:8000',
        proxyType: 'http',
        using: false,
        mode: 'direct',
        createdAt: 0,
        sessionId: 'test',
        scraperDailyLimit: limit,
        scraperUsageCount: limit ?? 1000,
        scraperUsageDate: '2026-09-24',
      })
      await syncWorkerProfile(ctx, (await ctx.db.get(profile))!)
      await ctx.db.insert('proxies', {
        name: 'test',
        proxy: 'proxy.test:8000',
        proxyType: 'http',
        country: 'gb',
        createdAt: 0,
      })
      const list = await ctx.db.insert('leadLists', { name: 'leads', createdAt: 0 })
      const job = await ctx.db.insert('scrapeSources', {
        username: 'source',
        listId: list,
        enabled: true,
        running: false,
        nextCheckAt: 0,
        postCount: 0,
        discovered: 0,
        createdAt: 0,
      })
      return { profile, job }
    })
    const midnight = Date.now()
    expect((await t.query(api.scraper.work, args)).taskAt).toBe(0)
    await t.run((ctx) =>
      patchProfile(ctx, ids.profile, { scraperCooldownUntil: midnight + 60_000 }),
    )
    expect((await t.query(api.scraper.work, args)).taskAt).toBe(midnight + 60_000)
    await t.run((ctx) => ctx.db.patch(ids.job, { running: true, leaseUntil: midnight + 120_000 }))
    expect((await t.query(api.scraper.work, args)).taskAt).toBe(midnight + 120_001)
    await t.run((ctx) => ctx.db.patch(ids.job, { enabled: false, running: false }))
    expect((await t.query(api.scraper.work, args)).taskAt).toBeNull()
  },
)

test('maintenance includes only deleting and renaming profiles', async () => {
  vi.stubEnv('INTERNAL_API_KEY', 'test-bridge')
  const t = createConvexTest()
  const args = { bridgeToken: 'test-bridge' }
  const [deleting, renaming] = await t.run(async (ctx) => {
    await ctx.db.insert('profiles', { name: 'idle', using: false, mode: 'direct', createdAt: 0 })
    return Promise.all([
      ctx.db.insert('profiles', {
        name: 'delete',
        using: false,
        mode: 'direct',
        createdAt: 0,
        status: 'deleting',
      }),
      ctx.db.insert('profiles', {
        name: 'rename',
        using: false,
        mode: 'direct',
        createdAt: 0,
        renameFrom: 'old',
      }),
    ])
  })
  expect(new Set((await t.query(api.profiles.queries.maintenanceWork, args)).profileIds)).toEqual(
    new Set([deleting, renaming]),
  )
  await t.run(async (ctx) => {
    await ctx.db.delete(deleting)
    await ctx.db.patch(renaming, { renameFrom: undefined })
  })
  expect(await t.query(api.profiles.queries.maintenanceWork, args)).toEqual({
    profileIds: [],
    modelIds: [],
  })
})
