import { v } from 'convex/values'
import { internalMutation, internalQuery, type MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { DomainError } from './errors'

// Archive status is durable metadata, independent of sessions and message caches.
export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    const profiles = await ctx.db.query('profiles').collect()
    const rows = await Promise.all(
      profiles
        .filter((profile) => profile.status !== 'deleting')
        .map((profile) =>
          ctx.db
            .query('chatArchives')
            .withIndex('by_profile_thread', (q) => q.eq('profileId', profile._id))
            .collect(),
        ),
    )
    return rows.flat().map(({ profileId, threadId }) => ({ profileId, threadId }))
  },
})

export const setArchived = internalMutation({
  args: { profileId: v.id('profiles'), threadId: v.string(), archived: v.boolean() },
  handler: async (ctx, { profileId, threadId, archived }) => {
    const profile = await ctx.db.get(profileId)
    if (!profile || profile.status === 'deleting')
      throw new DomainError('NOT_FOUND', 'Profile unavailable')
    if (!/^\d{1,40}$/.test(threadId)) throw new DomainError('VALIDATION', 'Invalid conversation ID')
    const row = await ctx.db
      .query('chatArchives')
      .withIndex('by_profile_thread', (q) => q.eq('profileId', profileId).eq('threadId', threadId))
      .unique()
    if (archived && !row) await ctx.db.insert('chatArchives', { profileId, threadId })
    else if (!archived && row) await ctx.db.delete(row._id)
  },
})

export async function clearProfileChatArchives(ctx: MutationCtx, profileId: Id<'profiles'>) {
  const rows = await ctx.db
    .query('chatArchives')
    .withIndex('by_profile_thread', (q) => q.eq('profileId', profileId))
    .collect()
  for (const row of rows) await ctx.db.delete(row._id)
}
