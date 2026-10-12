import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { normalizeProxy, proxyKey } from '../server/shared/proxy'

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
