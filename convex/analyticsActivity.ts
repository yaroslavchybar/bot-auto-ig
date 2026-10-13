import type { Doc } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'

export type ActivityCounts = Doc<'analyticsDays'>['counts']
export const emptyActivity = (): ActivityCounts => ({
  follows: 0,
  dms: 0,
  warmupMinutes: 0,
  scraperUnits: 0,
  scraperRequests: 0,
  unlimitedScraperUnits: 0,
})

export function addActivity(
  counts: ActivityCounts,
  delta: Partial<ActivityCounts>,
): ActivityCounts {
  return {
    follows: counts.follows + (delta.follows ?? 0),
    dms: counts.dms + (delta.dms ?? 0),
    warmupMinutes: counts.warmupMinutes + (delta.warmupMinutes ?? 0),
    scraperUnits: counts.scraperUnits + (delta.scraperUnits ?? 0),
    scraperRequests: (counts.scraperRequests ?? 0) + (delta.scraperRequests ?? 0),
    unlimitedScraperUnits: counts.unlimitedScraperUnits + (delta.unlimitedScraperUnits ?? 0),
  }
}

/** Called inside the successful action's transaction, after its existing retry guard. */
export async function recordActivity(
  ctx: MutationCtx,
  date: string,
  delta: Partial<ActivityCounts>,
) {
  if (!Object.values(delta).some((value) => value > 0)) return
  const history = await ctx.db.query('analyticsHistory').unique()
  // The first dashboard visit seeds surviving daily counters before tracking new activity.
  if (!history && !delta.scraperRequests) return
  const row = await ctx.db
    .query('analyticsDays')
    .withIndex('by_date', (q) => q.eq('date', date))
    .unique()
  const counts = addActivity(row?.counts ?? emptyActivity(), delta)
  if (row) await ctx.db.patch(row._id, { counts })
  else await ctx.db.insert('analyticsDays', { date, counts })
  if (history) await ctx.db.patch(history._id, { totals: addActivity(history.totals, delta) })
}
