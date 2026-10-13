import { afterEach, expect, test, vi } from 'vite-plus/test'
import type { GenericDatabaseWriter, GenericDataModel } from 'convex/server'
import { internal } from '../../convex/_generated/api'
import { createConvexTest } from './helpers'
import { recordActivity } from '../../convex/analyticsActivity'

afterEach(() => vi.useRealTimers())

test('new activity preserves historic request counts before the cleanup job runs', async () => {
  const t = createConvexTest()
  await t.run(async (ctx) => {
    const counts = {
      follows: 0,
      dms: 0,
      warmupMinutes: 0,
      scraperUnits: 0,
      unlimitedScraperUnits: 0,
      mobileRequests: 5,
      scraperRequests: 2,
    }
    await ctx.db.insert('analyticsDays', { date: '2026-10-14', counts })
    await ctx.db.insert('analyticsHistory', { startedAt: 1, totals: counts })
    await recordActivity(ctx, '2026-10-14', { scraperRequests: 1 })
    expect((await ctx.db.query('analyticsDays').unique())?.counts.scraperRequests).toBe(8)
    expect((await ctx.db.query('analyticsHistory').unique())?.totals.scraperRequests).toBe(8)
  })
  expect(await t.mutation(internal.browserScrapingMigration.run, {})).toEqual({ removed: 0 })
})

test('browser migration deletes mobile login files and preserves browser cookies, quotas and history', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-14T12:00:00Z'))
  const t = createConvexTest()
  const ids = await t.run(async (ctx) => {
    const profileId = await ctx.db.insert('profiles', {
      name: 'example',
      using: false,
      createdAt: 1,
      sessionId: 'browser-cookie',
      cookiesJson: 'browser-cookies',
    })
    const storageId = await ctx.storage.store(new Blob(['mobile-login']))
    const oldDb = ctx.db as GenericDatabaseWriter<GenericDataModel>
    await oldDb.insert('chatSessions', { profileId, storageId, token: 'obsolete' })
    await oldDb.insert('chatWorkerMetadata', { profileId, storageId, token: 'obsolete' })
    await oldDb.insert('mobileRequestUsage', {
      profileId,
      requests: [
        { id: 'old', at: Date.now() - 1000 },
        { id: 'expired', at: Date.now() - 3_600_001 },
      ],
    })
    await ctx.db.insert('scraperRequestUsage', {
      profileId,
      requests: [
        { id: 'old', at: Date.now() - 1000 },
        { id: 'new', at: Date.now() },
      ],
    })
    const counts = {
      follows: 1,
      dms: 2,
      warmupMinutes: 3,
      scraperUnits: 0,
      unlimitedScraperUnits: 0,
      mobileRequests: 5,
      scraperRequests: 2,
    }
    await ctx.db.insert('analyticsDays', { date: '2026-10-14', counts })
    await ctx.db.insert('analyticsHistory', { startedAt: 1, totals: counts })
    return { profileId, storageId }
  })
  expect(await t.mutation(internal.browserScrapingMigration.run, {})).toEqual({ removed: 5 })
  await t.run(async (ctx) => {
    const oldDb = ctx.db as GenericDatabaseWriter<GenericDataModel>
    for (const table of ['chatSessions', 'chatWorkerMetadata', 'mobileRequestUsage'])
      expect(await oldDb.query(table).collect()).toEqual([])
    expect(await ctx.storage.get(ids.storageId)).toBeNull()
    expect(await ctx.db.get(ids.profileId)).toMatchObject({
      sessionId: 'browser-cookie',
      cookiesJson: 'browser-cookies',
    })
    expect(await ctx.db.query('scraperProfiles').unique()).toMatchObject({ scraperReady: true })
    expect((await ctx.db.query('scraperRequestUsage').unique())?.requests).toHaveLength(2)
    expect((await ctx.db.query('analyticsDays').unique())?.counts).toMatchObject({
      scraperRequests: 7,
      follows: 1,
    })
    expect((await ctx.db.query('analyticsHistory').unique())?.totals.mobileRequests).toBeUndefined()
  })
  expect(await t.mutation(internal.browserScrapingMigration.run, {})).toEqual({ removed: 0 })
})
