import { v, type GenericId } from 'convex/values'
import type { GenericDataModel, GenericDatabaseWriter } from 'convex/server'
import { api, internal } from '../_generated/api'
import { internalMutation, internalQuery, type MutationCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { hasOutreachHistory, leadAvailable, setLeadAvailability } from '../leadMemberships'

// One-time deployment migration. Remove this module and its CI helper after production cleanup.
/** Upgrade unassigned leads in bounded pages; existing outreach history stays intact. */
export async function initializeScreening(ctx: MutationCtx) {
  let state = await ctx.db.query('leadScreeningMigration').unique()
  if (state?.complete) return
  if (state?.jobId) {
    const job = await ctx.db.system.get(state.jobId)
    if (job?.state.kind === 'pending' || job?.state.kind === 'inProgress') return
  }
  if (!state) {
    const id = await ctx.db.insert('leadScreeningMigration', {
      cursor: null,
      complete: false,
      processed: 0,
      reset: 0,
      cleaned: 0,
    })
    state = (await ctx.db.get(id))!
  }
  const jobId = await ctx.scheduler.runAfter(0, internal.migrations.leadScreening.backfill, {
    cursor: state.cursor,
  })
  await ctx.db.patch(state._id, { jobId })
}

/** Deployment runs this while the temporary schema still accepts retired fields. */
export const start = internalMutation({ args: {}, handler: initializeScreening })
export const migrationStatus = internalQuery({
  args: {},
  handler: (ctx) => ctx.db.query('leadScreeningMigration').unique(),
})

type LegacyLead = Omit<Doc<'leads'>, 'enrichmentStatus'> & {
  enrichmentStatus?: Doc<'leads'>['enrichmentStatus'] | 'describing'
  profilePicUrl?: string
  profilePicDescription?: string
  pictureBatchId?: string
}

export const backfill = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const state = await ctx.db.query('leadScreeningMigration').unique()
    if (!state || state.complete || state.cursor !== cursor) return
    const page = await ctx.db
      .query('leads')
      .paginate({ cursor, numItems: 100, maximumRowsRead: 100, maximumBytesRead: 1_000_000 })
    let reset = 0,
      cleaned = 0
    for (const row of page.page) {
      // Older documents are read only during the compatible-schema deployment.
      const lead = row as LegacyLead
      const {
        _id,
        _creationTime: _,
        profilePicUrl,
        profilePicDescription,
        pictureBatchId,
        ...data
      } = lead
      const hasRetiredFields =
        profilePicUrl !== undefined ||
        profilePicDescription !== undefined ||
        pictureBatchId !== undefined
      const requeue =
        !hasOutreachHistory(lead) && lead.enrichmentModel !== 'openai/gpt-6-luna-decisions'
      const next = {
        ...data,
        enrichmentStatus:
          data.enrichmentStatus === 'describing' ? ('pending' as const) : data.enrichmentStatus,
        ...(requeue
          ? {
              classification: undefined,
              enrichmentStatus: 'pending' as const,
              enrichmentModel: undefined,
              enrichmentConfidence: undefined,
              enrichedAt: undefined,
            }
          : {}),
      }
      if (hasRetiredFields || requeue || lead.enrichmentStatus === 'describing')
        await ctx.db.replace(_id, next)
      await setLeadAvailability(ctx, _id, leadAvailable(next))
      reset += Number(requeue)
      cleaned += Number(hasRetiredFields)
    }
    const jobId = !page.isDone
      ? await ctx.scheduler.runAfter(0, internal.migrations.leadScreening.backfill, {
          cursor: page.continueCursor,
        })
      : undefined
    await ctx.db.patch(state._id, {
      cursor: page.continueCursor,
      complete: page.isDone,
      jobId,
      processed: (state.processed ?? 0) + page.page.length,
      reset: (state.reset ?? 0) + reset,
      cleaned: (state.cleaned ?? 0) + cleaned,
    })
    if (page.isDone) {
      // The final schema no longer declares this retired singleton table.
      const retiredDb = ctx.db as GenericDatabaseWriter<GenericDataModel>
      const retired = await retiredDb.query('enrichmentWork').unique()
      if (retired) await retiredDb.delete(retired._id as GenericId<'enrichmentWork'>)
      const stats = await ctx.db.query('leadStats').unique()
      if (stats) await ctx.db.delete(stats._id)
      await ctx.scheduler.runAfter(0, api.leadStats.initialize, {})
    }
  },
})
