import { v } from 'convex/values'
import { internalMutation, internalQuery, type MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { DomainError } from './errors'

// Tags are durable app metadata, separate from disposable Instagram message caches.
export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    // The authenticated API's sole admin can access all existing profiles.
    const profiles = await ctx.db.query('profiles').collect()
    const rows = await Promise.all(
      profiles
        .filter((profile) => profile.status !== 'deleting')
        .map((profile) =>
          ctx.db
            .query('chatTags')
            .withIndex('by_profile_thread', (q) => q.eq('profileId', profile._id))
            .collect(),
        ),
    )
    return rows.flat().map(({ profileId, threadId, tags }) => ({ profileId, threadId, tags }))
  },
})

export const toggle = internalMutation({
  args: {
    profileId: v.id('profiles'),
    threadId: v.string(),
    tag: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, { profileId, threadId, tag, enabled }) => {
    const profile = await ctx.db.get(profileId)
    if (!profile || profile.status === 'deleting')
      throw new DomainError('NOT_FOUND', 'Profile unavailable')
    if (!/^\d{1,40}$/.test(threadId)) throw new DomainError('VALIDATION', 'Invalid conversation ID')
    const cleaned = tag.trim().replace(/\s+/g, ' ').toLowerCase()
    if (!cleaned || cleaned.length > 40)
      throw new DomainError('VALIDATION', 'Tags must contain 1–40 characters')
    const row = await ctx.db
      .query('chatTags')
      .withIndex('by_profile_thread', (q) => q.eq('profileId', profileId).eq('threadId', threadId))
      .unique()
    const previous = row?.tags ?? []
    if (previous.includes(cleaned) === enabled) return
    const tags = enabled
      ? [...previous, cleaned].sort()
      : previous.filter((item) => item !== cleaned)
    if (tags.length > 10)
      throw new DomainError('VALIDATION', 'A conversation can have up to 10 tags')
    if (row) {
      if (tags.length) await ctx.db.patch(row._id, { tags })
      else await ctx.db.delete(row._id)
    } else if (tags.length) await ctx.db.insert('chatTags', { profileId, threadId, tags })
  },
})

export async function clearProfileChatTags(ctx: MutationCtx, profileId: Id<'profiles'>) {
  const rows = await ctx.db
    .query('chatTags')
    .withIndex('by_profile_thread', (q) => q.eq('profileId', profileId))
    .collect()
  for (const row of rows) await ctx.db.delete(row._id)
}
