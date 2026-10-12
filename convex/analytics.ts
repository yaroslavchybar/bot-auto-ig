import { v } from 'convex/values'
import { mutation, query, type QueryCtx } from './_generated/server'
import { mobileRequestState } from './mobileRequests'
import { MOBILE_REQUEST_LIMIT } from './mobileRequestPolicy'
import { addActivity, emptyActivity, type ActivityCounts } from './analyticsActivity'

const periodValidator = v.union(
  v.literal('today'),
  v.literal('7days'),
  v.literal('30days'),
  v.literal('all'),
)

async function accountsForAnalytics(ctx: QueryCtx) {
  const migration = await ctx.db.query('workerMetadataMigration').unique()
  if (!migration?.complete)
    throw new Error('Account metadata is initializing. Please refresh shortly.')
  const profileRows = await ctx.db.query('scraperProfiles').take(1001)
  if (profileRows.length > 1000)
    throw new Error(
      'Analytics snapshot is too large. Narrower reporting is needed for this workspace.',
    )
  return profileRows.filter((row) => row.status !== 'deleting')
}

/** Seed only dates still held by the old daily counters; unavailable history is never invented. */
export const initialize = mutation({
  args: {},
  handler: async (ctx) => {
    if (await ctx.db.query('analyticsHistory').unique()) return
    const accounts = await accountsForAnalytics(ctx)
    const days = new Map<string, ActivityCounts>()
    const add = (date: string | undefined, delta: Partial<ActivityCounts>) => {
      if (!date || !Object.values(delta).some((value) => value > 0)) return
      days.set(date, addActivity(days.get(date) ?? emptyActivity(), delta))
    }
    for (const profile of accounts) {
      const [progress, warmup] = await Promise.all([
        ctx.db
          .query('accountProgress')
          .withIndex('by_profile', (q) => q.eq('profileId', profile.profileId))
          .unique(),
        ctx.db
          .query('warmupStates')
          .withIndex('by_profile', (q) => q.eq('profileId', profile.profileId))
          .unique(),
      ])
      add(progress?.followQuotaDate, { follows: progress?.followedToday ?? 0 })
      add(progress?.dmDate, { dms: progress?.sentToday ?? 0 })
      add(warmup?.date, {
        warmupMinutes: warmup?.minutesUsedToday ?? 0,
        follows: warmup?.followAttempts?.filter((attempt) => attempt.confirmed).length ?? 0,
      })
    }
    let totals = emptyActivity()
    // Request tracking starts before the first dashboard visit; preserve those counters.
    for (const row of await ctx.db.query('analyticsDays').collect()) {
      days.set(row.date, addActivity(row.counts, days.get(row.date) ?? emptyActivity()))
      await ctx.db.delete(row._id)
    }
    for (const [date, counts] of days) {
      await ctx.db.insert('analyticsDays', { date, counts })
      totals = addActivity(totals, counts)
    }
    await ctx.db.insert('analyticsHistory', { startedAt: Date.now(), totals })
  },
})

/** On-demand totals from small daily counters; lead counts remain a current inventory snapshot. */
export const overview = query({
  args: { date: v.string(), period: v.optional(periodValidator) },
  handler: async (ctx, { date, period = 'today' }) => {
    const timestamp = Date.parse(`${date}T00:00:00Z`)
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString().slice(0, 10) !== date
    )
      throw new Error('Invalid UTC date')
    const accounts = await accountsForAnalytics(ctx)
    const [leadStats, history] = await Promise.all([
      ctx.db.query('leadStats').unique(),
      ctx.db.query('analyticsHistory').unique(),
    ])
    if (!history) throw new Error('Activity history is initializing. Please refresh shortly.')
    let counts = history.totals
    if (period !== 'all') {
      const days = period === '7days' ? 7 : period === '30days' ? 30 : 1
      const start = new Date(timestamp - (days - 1) * 86_400_000).toISOString().slice(0, 10)
      const rows = await ctx.db
        .query('analyticsDays')
        .withIndex('by_date', (q) => q.gte('date', start).lte('date', date))
        .take(days)
      counts = rows.reduce((sum, row) => addActivity(sum, row.counts), emptyActivity())
    }
    const requestStates = await Promise.all(
      accounts.map((account) => mobileRequestState(ctx, account.profileId)),
    )
    return {
      period,
      historySince: new Date(history.startedAt).toISOString().slice(0, 10),
      leads: leadStats?.complete ? leadStats.counts : null,
      totals: {
        follows: counts.follows,
        dms: counts.dms,
        warmupMinutes: counts.warmupMinutes,
      },
      quota: {
        used:
          period === 'today'
            ? requestStates.reduce((sum, state) => sum + state.used, 0)
            : (counts.mobileRequests ?? 0),
        limit: accounts.length * MOBILE_REQUEST_LIMIT,
        totalRequests: counts.mobileRequests ?? 0,
        limitedAccounts: accounts.length,
        unlimitedAccounts: 0,
        unlimitedUsed: 0,
      },
    }
  },
})
