import { expect, test } from 'vite-plus/test'
import { api } from '../../convex/_generated/api'
import { createConvexTest } from './helpers'
import { emptyActivity, recordActivity } from '../../convex/analyticsActivity'

test('analytics counts confirmed daily activity, excludes deleted profiles, and does not reuse old lead quotas', async () => {
  const t = createConvexTest()
  await t.run(async (ctx) => {
    for (const [name, status, usageDate, limit] of [
      ['active', 'running', '2026-10-11', 1000],
      ['stale', 'idle', '2026-10-10', null],
      ['deleted', 'deleting', '2026-10-11', 1000],
    ] as const) {
      const profileId = await ctx.db.insert('profiles', {
        name,
        status,
        using: false,
        createdAt: 0,
        cookiesJson: 'never needed by analytics',
      })
      await ctx.db.insert('scraperProfiles', {
        profileId,
        name,
        status,
        using: false,
        scraperReady: true,
        scraperUsageDate: usageDate,
        scraperUsageCount: 99,
        scraperDailyLimit: limit,
      })
      await ctx.db.insert('accountProgress', {
        profileId,
        paused: false,
        activeDays: 5,
        outreachDays: 3,
        date: usageDate,
        used: 10,
        allowance: 20,
        followQuotaDate: usageDate,
        followedToday: 4,
        dmDate: usageDate,
        sentToday: 2,
        nextRunAt: 0,
        startedAt: 0,
        updatedAt: 0,
      })
      await ctx.db.insert('warmupStates', {
        profileId,
        date: usageDate,
        day: 8,
        todayMinutes: 30,
        minutesUsedToday: 12.5,
        runsToday: 1,
        updatedAt: 0,
      })
    }
  })
  await t.mutation(api.analytics.initialize, {})
  await t.mutation(api.analytics.initialize, {})
  const result = await t.query(api.analytics.overview, { date: '2026-10-11' })
  expect(result.totals).toMatchObject({
    follows: 4,
    dms: 2,
    warmupMinutes: 12.5,
  })
  expect(result.leads).toBeNull()
  expect(result.quota).toMatchObject({
    used: 0,
    limit: 20,
    unlimitedAccounts: 0,
    unlimitedUsed: 0,
  })
  const previous = await t.query(api.analytics.overview, { date: '2026-10-10' })
  expect(previous.totals).toEqual({ follows: 4, dms: 2, warmupMinutes: 12.5 })
  expect(previous.quota.unlimitedUsed).toBe(0)
  expect((await t.run((ctx) => ctx.db.query('analyticsDays').collect())).length).toBe(2)
})

test('analytics reads initialized unique lead totals from the small counter', async () => {
  const t = createConvexTest()
  await t.mutation(api.analytics.initialize, {})
  expect((await t.query(api.analytics.overview, { date: '2026-10-11' })).leads).toBeNull()
  await t.mutation(api.leadStats.initialize, {})
  expect((await t.query(api.analytics.overview, { date: '2026-10-11' })).leads).toEqual({
    total: 0,
    pending: 0,
    enriched: 0,
    male: 0,
    ready: 0,
    assigned: 0,
  })
})

test('date ranges include today, respect UTC boundaries and leave current lead inventory unchanged', async () => {
  const t = createConvexTest()
  await t.mutation(api.analytics.initialize, {})
  await t.mutation(api.leadStats.initialize, {})
  await t.run(async (ctx) => {
    for (const [date, count] of [
      ['2026-09-11', 10000], // Outside 30 days.
      ['2026-09-12', 1000], // First of 30 days.
      ['2026-10-04', 100], // Outside 7 days.
      ['2026-10-05', 10], // First of 7 days.
      ['2026-10-11', 1],
    ] as const) {
      await recordActivity(ctx, date, {
        follows: count,
        dms: count * 2,
        warmupMinutes: count / 2,
        mobileRequests: count,
      })
    }
  })
  for (const [period, count] of [
    ['today', 1],
    ['7days', 11],
    ['30days', 1111],
    ['all', 11111],
  ] as const) {
    const result = await t.query(api.analytics.overview, { date: '2026-10-11', period })
    expect(result.totals).toEqual({ follows: count, dms: count * 2, warmupMinutes: count / 2 })
    expect(result.quota.totalRequests).toBe(count)
    expect(result.quota.used).toBe(period === 'today' ? 0 : count)
    expect(result.leads).toMatchObject({ total: 0, pending: 0 })
    expect(result.period).toBe(period)
  }
  // A result on the next UTC date must not leak into a bounded range.
  await t.run((ctx) => recordActivity(ctx, '2026-10-12', { follows: 50000 }))
  expect(
    (await t.query(api.analytics.overview, { date: '2026-10-11', period: '30days' })).totals
      .follows,
  ).toBe(1111)
})

test('zero activity does not write counters and re-initializing preserves existing history', async () => {
  const t = createConvexTest()
  await t.mutation(api.analytics.initialize, {})
  await t.run((ctx) => recordActivity(ctx, '2026-10-11', emptyActivity()))
  expect(await t.run((ctx) => ctx.db.query('analyticsDays').collect())).toEqual([])
  await t.run((ctx) => recordActivity(ctx, '2026-10-11', { follows: 2, mobileRequests: 4 }))
  await t.mutation(api.analytics.initialize, {})
  const result = await t.query(api.analytics.overview, { date: '2026-10-11', period: 'all' })
  expect(result.totals.follows).toBe(2)
  expect(result.quota).toMatchObject({ unlimitedAccounts: 0, unlimitedUsed: 0, totalRequests: 4 })
})

test('analytics refuses uninitialized activity history and invalid dates', async () => {
  const t = createConvexTest()
  await expect(t.query(api.analytics.overview, { date: '2026-10-11' })).rejects.toThrow(
    'Activity history is initializing',
  )
  await expect(t.query(api.analytics.overview, { date: '2026-02-30' })).rejects.toThrow(
    'Invalid UTC date',
  )
  await expect(t.query(api.analytics.overview, { date: '2026-13-01' })).rejects.toThrow(
    'Invalid UTC date',
  )
})
