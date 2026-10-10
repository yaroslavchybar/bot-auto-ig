import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation, mutation, type MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { normalizeProxy, proxyKey } from '../server/shared/proxy'
import { SCAN_BATCH_BYTES } from '../server/shared/pagination'

/** Update the projection in the same transaction as a profile's name or proxy. */
export async function syncProxyUsage(
  ctx: MutationCtx,
  profile: Pick<Doc<'profiles'>, '_id' | 'name' | 'proxy' | 'proxyType'>,
) {
  const existing = await ctx.db
    .query('proxyProfileAssignments')
    .withIndex('by_profile', (q) => q.eq('profileId', profile._id))
    .unique()
  const key = proxyKey(profile.proxy, profile.proxyType)
  if (!key) {
    if (existing) await ctx.db.delete(existing._id)
    return
  }
  const { proxy, proxyType } = normalizeProxy(key)
  const fields = { profileId: profile._id, name: profile.name, proxy, proxyType }
  if (!existing) await ctx.db.insert('proxyProfileAssignments', fields)
  else if (
    existing.name !== fields.name ||
    existing.proxy !== proxy ||
    existing.proxyType !== proxyType
  )
    await ctx.db.patch(existing._id, fields)
}

export async function clearProxyUsage(ctx: MutationCtx, profileId: Id<'profiles'>) {
  const existing = await ctx.db
    .query('proxyProfileAssignments')
    .withIndex('by_profile', (q) => q.eq('profileId', profileId))
    .unique()
  if (existing) await ctx.db.delete(existing._id)
}

/** Populate existing profiles once, in bounded transactions when proxy options are opened. */
export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    let state = await ctx.db.query('proxyUsageMigration').first()
    if (state?.complete) return
    if (state?.jobId) {
      const job = await ctx.db.system.get(state.jobId)
      if (job?.state.kind === 'pending' || job?.state.kind === 'inProgress') return
    }
    if (!state) {
      const id = await ctx.db.insert('proxyUsageMigration', { cursor: null, complete: false })
      state = (await ctx.db.get(id))!
    }
    const jobId = await ctx.scheduler.runAfter(0, internal.proxyUsage.backfill, {
      cursor: state.cursor,
    })
    await ctx.db.patch(state._id, { jobId })
  },
})

export const backfill = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const state = await ctx.db.query('proxyUsageMigration').first()
    // Duplicate jobs and stale retries cannot overwrite newer progress.
    if (!state || state.complete || state.cursor !== cursor) return
    const page = await ctx.db.query('profiles').withIndex('by_created').paginate({
      cursor,
      numItems: 100,
      maximumRowsRead: 100,
      maximumBytesRead: SCAN_BATCH_BYTES,
    })
    for (const profile of page.page) await syncProxyUsage(ctx, profile)
    const jobId = page.isDone
      ? undefined
      : await ctx.scheduler.runAfter(0, internal.proxyUsage.backfill, {
          cursor: page.continueCursor,
        })
    await ctx.db.patch(state._id, { cursor: page.continueCursor, complete: page.isDone, jobId })
  },
})
