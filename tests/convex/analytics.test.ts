import { expect, test } from 'vite-plus/test'
import { api } from '../../convex/_generated/api'
import { createConvexTest } from './helpers'
import { emptyActivity, recordActivity } from '../../convex/analyticsActivity'

test('recorded activity survives profile deletion and stays in its UTC bucket', async () => {
  const t = createConvexTest()
  const id = await t.run(async ctx => {
    const id = await ctx.db.insert('profiles', { name: 'Profile', inUse: false, createdAt: 0 })
    await recordActivity(ctx, '2026-10-11', { follows: 4, dms: 2, warmupMinutes: 12.5 })
    return id
  })
  await t.run(ctx => ctx.db.delete(id))
  expect((await t.query(api.analytics.overview, { date: '2026-10-11' })).totals)
    .toEqual({ follows: 4, dms: 2, warmupMinutes: 12.5 })
  expect((await t.query(api.analytics.overview, { date: '2026-10-10' })).totals.follows).toBe(0)
})

test('analytics reads initialized unique lead totals from the small counter', async () => {
  const t = createConvexTest()
  expect((await t.query(api.analytics.overview, { date: '2026-10-11' })).leads).toBeNull()
  await t.mutation(api.leadStats.initialize, {})
  expect((await t.query(api.analytics.overview, { date: '2026-10-11' })).leads).toEqual({
    total: 0,
    male: 0,
    assigned: 0,
  })
})

test('date ranges include today, respect UTC boundaries and leave current lead inventory unchanged', async () => {
  const t = createConvexTest()
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
        scraperRequests: count,
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
    expect(result.leads).toMatchObject({ total: 0 })
    expect(result.period).toBe(period)
  }
  // A result on the next UTC date must not leak into a bounded range.
  await t.run((ctx) => recordActivity(ctx, '2026-10-12', { follows: 50000 }))
  expect(
    (await t.query(api.analytics.overview, { date: '2026-10-11', period: '30days' })).totals
      .follows,
  ).toBe(1111)
})

test('zero activity does not write counters and the first activity creates history', async () => {
  const t = createConvexTest()
  await t.run((ctx) => recordActivity(ctx, '2026-10-11', emptyActivity()))
  expect(await t.run((ctx) => ctx.db.query('analyticsDays').collect())).toEqual([])
  await t.run((ctx) => recordActivity(ctx, '2026-10-11', { follows: 2, scraperRequests: 4 }))
  const result = await t.query(api.analytics.overview, { date: '2026-10-11', period: 'all' })
  expect(result.totals.follows).toBe(2)
  expect((await t.run(ctx => ctx.db.query('analyticsHistory').unique()))?.totals.scraperRequests).toBe(4)
})

test('analytics returns zero before first activity and rejects invalid dates', async () => {
  const t = createConvexTest()
  expect((await t.query(api.analytics.overview, { date: '2026-10-11' })).totals).toEqual({ follows: 0, dms: 0, warmupMinutes: 0 })
  await expect(t.query(api.analytics.overview, { date: '2026-02-30' })).rejects.toThrow(
    'Invalid UTC date',
  )
  await expect(t.query(api.analytics.overview, { date: '2026-13-01' })).rejects.toThrow(
    'Invalid UTC date',
  )
})
