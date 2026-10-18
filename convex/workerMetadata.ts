import { internal } from './_generated/api'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

/** Only writes when worker-visible fields change; cookies and setup progress stay isolated. */
export async function syncWorkerProfile(ctx: MutationCtx, profile: Doc<'profiles'>) {
  const scraper = await ctx.db
    .query('scraperProfiles')
    .withIndex('by_profile', (q) => q.eq('profileId', profile._id))
    .unique()
  const fields = {
    profileId: profile._id,
    name: profile.name,
    paused: profile.paused === true,
    proxy: profile.proxy,
    proxyType: profile.proxyType,
    inUse: profile.inUse,
    status: profile.status,
    pendingRenameFrom: profile.pendingRenameFrom,
    scraperReady: !profile.paused && !!profile.instagramSessionId,
    scraperCooldownUntil: profile.scraperCooldownUntil,
  }
  if (!scraper) await ctx.db.insert('scraperProfiles', fields)
  else if (
    Object.entries(fields).some(([key, value]) => scraper[key as keyof typeof fields] !== value)
  )
    await ctx.db.patch(scraper._id, fields)
}

const workerFields = new Set([
  'paused',
  'name',
  'inUse',
  'status',
  'pendingRenameFrom',
  'instagramSessionId',
  'igLoggedIn',
  'proxy',
  'proxyType',
  'scraperCooldownUntil',
])

export async function patchProfile(
  ctx: MutationCtx,
  id: Id<'profiles'>,
  patch: Partial<Doc<'profiles'>>,
) {
  await ctx.db.patch(id, patch)
  if (Object.keys(patch).some((key) => workerFields.has(key))) {
    const profile = await ctx.db.get(id)
    if (profile) await syncWorkerProfile(ctx, profile)
  }
}

/** Source totals change only when profiles are added or removed, never on heartbeats. */
export async function syncSourceCount(ctx: MutationCtx, listId: Id<'leadLists'>) {
  if (!(await ctx.db.get(listId))) return
  const sources = await ctx.db
    .query('scrapeSources')
    .withIndex('by_list_username', (q) => q.eq('listId', listId))
    .take(101)
  const sourceCount = sources.filter((source) => !source.deleting).length
  const counter = await ctx.db
    .query('leadListCounts')
    .withIndex('by_list', (q) => q.eq('listId', listId))
    .unique()
  if (!counter) {
    await ctx.db.insert('leadListCounts', { listId, sourceCount, revision: 0 })
    await ctx.scheduler.runAfter(0, internal.leads.backfillCount, { listId, count: 0, revision: 0 })
  } else if (counter.sourceCount !== sourceCount) await ctx.db.patch(counter._id, { sourceCount })
}
