import { v } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import { internal } from './_generated/api'
import { internalMutation, mutation, type MutationCtx } from './_generated/server'
import { leadAvailable } from './leadMemberships'

type Counts = Doc<'leadStats'>['counts']
type Lead = Parameters<typeof leadAvailable>[0]
const empty = (): Counts => ({ total: 0, male: 0, assigned: 0 })
const keys = ['total', 'male', 'assigned'] as const

function countsFor(lead: Lead | null): Counts {
  if (!lead) return empty()
  const enriched = lead.screeningStatus === 'ready'
  return {
    total: 1,
    male: Number(enriched && lead.classification === 'male'),
    assigned: Number(!!lead.senderId),
  }
}

/** Accumulate changes locally so a batch writes the small counter only once. */
export class LeadStatsChanges {
  private delta = empty()
  private changed = false
  add(before: Lead | null, after: Lead | null) {
    const old = countsFor(before),
      next = countsFor(after)
    for (const key of keys) {
      if (next[key] !== old[key]) this.changed = true
      this.delta[key] += next[key] - old[key]
    }
  }
  async flush(ctx: MutationCtx) {
    if (!this.changed) return
    const state = await ctx.db.query('leadStats').unique()
    // First Analytics visit backfills existing data; ordinary writes need no migration scan.
    if (!state) return
    if (!state.backfillComplete) {
      await ctx.db.patch(state._id, { dataRevision: state.dataRevision + 1 })
      return
    }
    if (!keys.some((key) => this.delta[key])) return
    const counts = { ...state.counts }
    for (const key of keys) counts[key] += this.delta[key]
    await ctx.db.patch(state._id, { counts })
  }
}

/** Idempotent initialization; a failed scheduled page can resume on the next visit. */
export const initialize = mutation({
  args: {},
  handler: async (ctx) => {
    let state = await ctx.db.query('leadStats').unique()
    if (state?.backfillComplete) return
    if (state?.backfillJobId) {
      const job = await ctx.db.system.get(state.backfillJobId)
      if (job?.state.kind === 'pending' || job?.state.kind === 'inProgress') return
    }
    if (!state) {
      const backfillComplete = !(await ctx.db.query('leads').first())
      const id = await ctx.db.insert('leadStats', {
        counts: empty(),
        dataRevision: 0,
        backfillRevision: 0,
        backfillCursor: null,
        backfillComplete,
      })
      state = (await ctx.db.get(id))!
      if (backfillComplete) return
    }
    const backfillJobId = await ctx.scheduler.runAfter(0, internal.leadStats.backfill, {
      cursor: state.backfillCursor,
    })
    await ctx.db.patch(state._id, { backfillJobId })
  },
})

/** Bounded initial scan restarts if lead counters change between pages. */
export const backfill = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const state = await ctx.db.query('leadStats').unique()
    if (!state || state.backfillComplete || state.backfillCursor !== cursor) return
    const unchanged = state.backfillRevision === state.dataRevision
    const page = await ctx.db
      .query('leads')
      .paginate({
        cursor: unchanged ? cursor : null,
        numItems: 200,
        maximumRowsRead: 200,
        maximumBytesRead: 1_000_000,
      })
    const counts = unchanged ? { ...state.counts } : empty()
    for (const lead of page.page) {
      const next = countsFor(lead)
      for (const key of keys) counts[key] += next[key]
    }
    const backfillJobId = page.isDone
      ? undefined
      : await ctx.scheduler.runAfter(0, internal.leadStats.backfill, {
          cursor: page.continueCursor,
        })
    await ctx.db.patch(state._id, {
      counts,
      backfillCursor: page.continueCursor,
      backfillRevision: state.dataRevision,
      backfillComplete: page.isDone,
      backfillJobId,
    })
  },
})
