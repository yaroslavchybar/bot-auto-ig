import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation, type MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

/** Only writes when worker-visible fields change; cookies and setup progress stay isolated. */
export async function syncWorkerProfile(ctx: MutationCtx, profile: Doc<'profiles'>) {
  const session = await ctx.db.query('chatSessions')
    .withIndex('by_profile', q => q.eq('profileId', profile._id)).unique()
  const scraper = await ctx.db.query('scraperProfiles')
    .withIndex('by_profile', q => q.eq('profileId', profile._id)).unique()
  const fields = {
    profileId: profile._id,
    name: profile.name,
    using: profile.using,
    status: profile.status,
    renameFrom: profile.renameFrom,
    scraperReady: !!profile.sessionId || (!!session && !session.reconnectRequired),
    scraperDailyLimit: profile.scraperDailyLimit,
    scraperUsageDate: profile.scraperUsageDate,
    scraperUsageCount: profile.scraperUsageCount,
    scraperCooldownUntil: profile.scraperCooldownUntil,
  }
  if (!scraper) await ctx.db.insert('scraperProfiles', fields)
  else if (Object.entries(fields).some(([key, value]) => scraper[key as keyof typeof fields] !== value))
    await ctx.db.patch(scraper._id, fields)

  const chat = await ctx.db.query('chatWorkerMetadata')
    .withIndex('by_profile', q => q.eq('profileId', profile._id)).unique()
  if (!session || profile.status === 'deleting') {
    if (chat) await ctx.db.delete(chat._id)
    return
  }
  const context = {
    profileId: profile._id,
    storageId: session.storageId,
    token: session.token,
    reconnectRequired: session.reconnectRequired === true,
    enabled: profile.igLoggedIn === true && session.reconnectRequired !== true,
    proxy: profile.proxy ?? '',
    proxyType: profile.proxyType ?? '',
  }
  if (!chat) await ctx.db.insert('chatWorkerMetadata', context)
  else if (Object.entries(context).some(([key, value]) => chat[key as keyof typeof context] !== value))
    await ctx.db.patch(chat._id, context)
}

const workerFields = new Set([
  'name', 'using', 'status', 'renameFrom', 'sessionId', 'igLoggedIn', 'proxy', 'proxyType',
  'scraperDailyLimit', 'scraperUsageDate', 'scraperUsageCount', 'scraperCooldownUntil',
])

export async function patchProfile(ctx: MutationCtx, id: Id<'profiles'>, patch: Partial<Doc<'profiles'>>) {
  await ctx.db.patch(id, patch)
  if (Object.keys(patch).some(key => workerFields.has(key))) {
    const profile = await ctx.db.get(id)
    if (profile) await syncWorkerProfile(ctx, profile)
  }
}

export async function clearWorkerProfile(ctx: MutationCtx, profileId: Id<'profiles'>) {
  for (const table of ['scraperProfiles', 'chatWorkerMetadata'] as const) {
    const row = await ctx.db.query(table).withIndex('by_profile', q => q.eq('profileId', profileId)).unique()
    if (row) await ctx.db.delete(row._id)
  }
}

/** Publish only empty/nonempty transitions, not every enriched lead or description checkpoint. */
export async function refreshEnrichmentWork(ctx: MutationCtx) {
  const [describing, pending, state] = await Promise.all([
    ctx.db.query('leads').withIndex('by_enrichment', q => q.eq('enrichmentStatus', 'describing')).first(),
    ctx.db.query('leads').withIndex('by_enrichment', q => q.eq('enrichmentStatus', 'pending')).first(),
    ctx.db.query('enrichmentWork').unique(),
  ])
  const hasWork = !!(describing || pending)
  if (!state) await ctx.db.insert('enrichmentWork', { pending: hasWork })
  else if (state.pending !== hasWork) await ctx.db.patch(state._id, { pending: hasWork })
}

/** Source totals change only when profiles are added or removed, never on heartbeats. */
export async function syncSourceCount(ctx: MutationCtx, listId: Id<'leadLists'>) {
  if (!await ctx.db.get(listId)) return
  const sources = await ctx.db.query('scrapeSources')
    .withIndex('by_list_username', q => q.eq('listId', listId)).take(101)
  const sourceCount = sources.filter(source => !source.deleting).length
  const counter = await ctx.db.query('leadListCounts').withIndex('by_list', q => q.eq('listId', listId)).unique()
  if (!counter) {
    await ctx.db.insert('leadListCounts', { listId, sourceCount, revision: 0 })
    await ctx.scheduler.runAfter(0, internal.leads.backfillCount, { listId, count: 0, revision: 0 })
  }
  else if (counter.sourceCount !== sourceCount) await ctx.db.patch(counter._id, { sourceCount })
}

/** Startup backfill is resumable and bounded; readers use the original data until it finishes. */
export const initialize = internalMutation({
  args: {},
  handler: async ctx => {
    await refreshEnrichmentWork(ctx)
    let state = await ctx.db.query('workerMetadataMigration').unique()
    if (state?.complete) return
    if (state?.jobId) {
      const job = await ctx.db.system.get(state.jobId)
      if (job?.state.kind === 'pending' || job?.state.kind === 'inProgress') return
    }
    if (!state) {
      const id = await ctx.db.insert('workerMetadataMigration', { cursor: null, complete: false })
      state = (await ctx.db.get(id))!
    }
    const jobId = await ctx.scheduler.runAfter(0, internal.workerMetadata.backfill, { cursor: state.cursor })
    await ctx.db.patch(state._id, { jobId })
  },
})

export const backfill = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const state = await ctx.db.query('workerMetadataMigration').unique()
    if (!state || state.complete || state.cursor !== cursor) return
    const page = await ctx.db.query('profiles').paginate({ cursor, numItems: 100, maximumRowsRead: 100, maximumBytesRead: 1_000_000 })
    for (const profile of page.page) await syncWorkerProfile(ctx, profile)
    const jobId = page.isDone ? undefined : await ctx.scheduler.runAfter(0, internal.workerMetadata.backfill, { cursor: page.continueCursor })
    await ctx.db.patch(state._id, { cursor: page.continueCursor, complete: page.isDone, jobId })
    if (page.isDone) await ctx.scheduler.runAfter(0, internal.workerMetadata.backfillSources, {})
  },
})

export const backfillSources = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query('leadLists').paginate({ cursor: cursor ?? null, numItems: 10 })
    for (const list of page.page) await syncSourceCount(ctx, list._id)
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.workerMetadata.backfillSources, { cursor: page.continueCursor })
  },
})
