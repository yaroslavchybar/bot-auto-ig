import { v } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import { internal } from './_generated/api'
import { internalMutation, mutation, type MutationCtx } from './_generated/server'
import { leadAvailable } from './leadMemberships'

type Counts = Doc<'leadStats'>['counts']
type Lead = Parameters<typeof leadAvailable>[0]
const empty = (): Counts => ({ total: 0, pending: 0, enriched: 0, male: 0, ready: 0, assigned: 0 })
const keys = ['total', 'pending', 'enriched', 'male', 'ready', 'assigned'] as const

function countsFor(lead: Lead | null): Counts {
  if (!lead) return empty()
  const enriched = lead.enrichmentStatus === 'ready'
  return {
    total: 1,
    pending: Number(lead.enrichmentStatus === 'pending'),
    enriched: Number(enriched),
    male: Number(enriched && lead.classification === 'male'),
    ready: Number(enriched && !!lead.classification && leadAvailable(lead)),
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
    if (!state.complete) {
      await ctx.db.patch(state._id, { revision: state.revision + 1 })
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
    if (state?.complete) return
    if (state?.jobId) {
      const job = await ctx.db.system.get(state.jobId)
      if (job?.state.kind === 'pending' || job?.state.kind === 'inProgress') return
    }
    if (!state) {
      const complete = !(await ctx.db.query('leads').first())
      const id = await ctx.db.insert('leadStats', {
        counts: empty(),
        revision: 0,
        scanRevision: 0,
        cursor: null,
        complete,
      })
      state = (await ctx.db.get(id))!
      if (complete) return
    }
    const jobId = await ctx.scheduler.runAfter(0, internal.leadStats.backfill, {
      cursor: state.cursor,
    })
    await ctx.db.patch(state._id, { jobId })
  },
})

/** Bounded initial scan restarts if lead counters change between pages. */
export const backfill = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const state = await ctx.db.query('leadStats').unique()
    if (!state || state.complete || state.cursor !== cursor) return
    const unchanged = state.scanRevision === state.revision
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
    const jobId = page.isDone
      ? undefined
      : await ctx.scheduler.runAfter(0, internal.leadStats.backfill, {
          cursor: page.continueCursor,
        })
    await ctx.db.patch(state._id, {
      counts,
      cursor: page.continueCursor,
      scanRevision: state.revision,
      complete: page.isDone,
      jobId,
    })
  },
})
