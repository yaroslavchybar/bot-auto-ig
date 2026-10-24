import { internalMutation } from '../_generated/server'
import { addActivity, emptyActivity, type ActivityCounts } from '../analyticsActivity'
import { setProfilePaused } from '../profilePause'
import { syncWorkerProfile } from '../workerMetadata'

/** One-time expand/migrate/contract step. Run by CI before replacing the app workers. */
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    // This workspace is small. Refuse an incomplete migration rather than silently truncating it.
    const read = async <
      T extends
        | 'profiles'
        | 'automations'
        | 'accountProgress'
        | 'profileModelAssignments'
        | 'analyticsDays',
    >(
      table: T,
    ) => {
      const rows = await ctx.db.query(table).take(1001)
      if (rows.length > 1000)
        throw new Error(
          `Simplification migration exceeds 1,000 ${table} rows; use a paginated migration`,
        )
      return rows
    }
    const profiles = await read('profiles')
    const automations = await read('automations')
    const progress = await read('accountProgress')
    const memberships = await read('profileModelAssignments')
    const history = await ctx.db.query('analyticsHistory').unique()
    const pending =
      memberships.length ||
      profiles.some((p) => p.modelIds !== undefined) ||
      progress.some((p) => p.paused !== undefined || p.lastLeadListId !== undefined) ||
      automations.some(
        (a) =>
          a.nodes !== undefined ||
          a.edges !== undefined ||
          a.nodeStates !== undefined ||
          a.currentNodeId !== undefined ||
          a.routine?.outreachRoutes !== undefined ||
          a.routine?.message !== undefined ||
          a.routine?.leadListId !== undefined ||
          a.routine?.outreachStartDay !== undefined ||
          a.routine?.dailyIncrease !== undefined,
      )
    if (!pending && (history || !(await ctx.db.query('analyticsDays').first())))
      return { migrated: false }
    if (
      profiles.some(
        (p) =>
          p.inUse ||
          ['running', 'starting', 'deleting'].includes(p.status ?? '') ||
          p.pendingRenameFrom,
      ) ||
      automations.some((a) => a.isActive || ['running', 'pending'].includes(a.status ?? ''))
    )
      throw new Error('Disable automations and stop profiles before the simplification migration')

    if (!history) {
      const sources = await ctx.db.query('scrapeSources').take(1001)
      if (sources.length > 1000 || sources.some((source) => source.enabled || source.running))
        throw new Error(
          'Pause scraping and wait for requests to finish before migrating uninitialized analytics',
        )
    }

    for (const automation of automations) {
      if (!automation.routine)
        throw new Error(
          `Graph automation ${automation._id} must be retired explicitly before migration`,
        )
      const {
        outreachRoutes,
        leadListId,
        message,
        outreachStartDay: _day,
        dailyIncrease: _increase,
        ...routine
      } = automation.routine
      if ((outreachRoutes?.length ?? 0) > 1)
        throw new Error(`Automation ${automation._id} has multiple outreach assignments`)
      const outreach =
        routine.outreach ??
        (outreachRoutes !== undefined
          ? outreachRoutes[0]
          : leadListId
            ? { leadListId, profileIds: [], allProfiles: true, message: message ?? '' }
            : undefined)
      await ctx.db.patch(automation._id, {
        routine: { ...routine, outreach },
        nodes: undefined,
        edges: undefined,
        currentNodeId: undefined,
        nodeStates: undefined,
      })
    }
    for (const profile of profiles) {
      const ids = new Set([
        ...(profile.modelIds ?? []),
        ...(profile.modelId ? [profile.modelId] : []),
      ])
      const indexed = new Set(
        memberships.filter((m) => m.profileId === profile._id).map((m) => m.modelId),
      )
      if (ids.size > 1 || indexed.size > 1 || [...indexed].some((id) => !ids.has(id)))
        throw new Error(`Profile ${profile._id} has conflicting model assignments`)
      const state = progress.find((p) => p.profileId === profile._id)
      if (state?.paused || profile.paused) await setProfilePaused(ctx, profile._id, true)
      await ctx.db.patch(profile._id, { modelId: [...ids][0], modelIds: undefined })
      await syncWorkerProfile(ctx, (await ctx.db.get(profile._id))!)
    }
    for (const state of progress)
      await ctx.db.patch(state._id, { paused: undefined, lastLeadListId: undefined })
    for (const membership of memberships) await ctx.db.delete(membership._id)

    // Existing history already includes the surviving daily counters. Never seed it twice.
    if (!history) {
      const days = new Map<string, ActivityCounts>()
      const add = (date: string | undefined, delta: Partial<ActivityCounts>) => {
        if (date && Object.values(delta).some((value) => value > 0))
          days.set(date, addActivity(days.get(date) ?? emptyActivity(), delta))
      }
      for (const profile of profiles.filter((p) => p.status !== 'deleting')) {
        const state = progress.find((p) => p.profileId === profile._id)
        const warmup = await ctx.db
          .query('warmupStates')
          .withIndex('by_profile', (q) => q.eq('profileId', profile._id))
          .unique()
        add(state?.outreachQuotaDate, { follows: state?.followedToday ?? 0 })
        add(state?.dmCountDate, { dms: state?.sentToday ?? 0 })
        add(warmup?.date, {
          warmupMinutes: warmup?.minutesUsedToday ?? 0,
          follows: warmup?.followAttempts?.filter((attempt) => attempt.confirmed).length ?? 0,
        })
      }
      const existing = await read('analyticsDays')
      for (const row of existing) add(row.date, row.counts)
      let totals = emptyActivity()
      for (const [date, counts] of days) {
        const row = existing.find((row) => row.date === date)
        if (row) await ctx.db.patch(row._id, { counts })
        else await ctx.db.insert('analyticsDays', { date, counts })
        totals = addActivity(totals, counts)
      }
      await ctx.db.insert('analyticsHistory', { startedAt: Date.now(), totals })
    }
    return { migrated: true, profiles: profiles.length, automations: automations.length }
  },
})
