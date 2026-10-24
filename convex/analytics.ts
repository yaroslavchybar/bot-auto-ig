import { v } from 'convex/values'
import { query, type QueryCtx } from './_generated/server'
import { addActivity, emptyActivity } from './analyticsActivity'
import { outreachSummary } from './outreachAnalytics'

const periodValidator = v.union(
  v.literal('today'),
  v.literal('7days'),
  v.literal('30days'),
  v.literal('all'),
)

async function accountsForAnalytics(ctx: QueryCtx) {
  const profileRows = await ctx.db.query('scraperProfiles').take(1001)
  if (profileRows.length > 1000)
    throw new Error(
      'Analytics snapshot is too large. Narrower reporting is needed for this workspace.',
    )
  return profileRows.filter((row) => row.status !== 'deleting')
}

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
    const days = period === 'all' ? null : period === '7days' ? 7 : period === '30days' ? 30 : 1
    const start = days === null ? undefined : new Date(timestamp - (days - 1) * 86_400_000).toISOString().slice(0, 10)
    let counts = history?.totals ?? emptyActivity()
    if (start !== undefined && days !== null) {
      const rows = await ctx.db
        .query('analyticsDays')
        .withIndex('by_date', (q) => q.gte('date', start).lte('date', date))
        .take(days)
      counts = rows.reduce((sum, row) => addActivity(sum, row.counts), emptyActivity())
    }
    return {
      period,
      historySince: history ? new Date(history.startedAt).toISOString().slice(0, 10) : null,
      outreach: await outreachSummary(ctx, start, date, accounts),
      leads: leadStats?.backfillComplete ? leadStats.counts : null,
      totals: {
        follows: counts.follows,
        dms: counts.dms,
        warmupMinutes: counts.warmupMinutes,
      },
    }
  },
})
