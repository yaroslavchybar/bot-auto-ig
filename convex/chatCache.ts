import { v } from 'convex/values'
import type { GenericId } from 'convex/values'
import { internalMutation, query, type MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { GenericDatabaseWriter, GenericDataModel } from 'convex/server'
import { DomainError } from './errors'

// Reads only badge metadata and archives; session refreshes and cookies cannot invalidate it.
export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const counters = await ctx.db.query('chatCounters').collect()
    const counts = await Promise.all(
      counters.map(async (row) => {
        if (!row.enabled || !row.unreadCount) return 0
        // Existing summaries gain conversation IDs on the next server publication.
        if (!row.unreadThreadIds) return row.unreadCount
        const archives = await Promise.all(
          row.unreadThreadIds.map((threadId) =>
            ctx.db
              .query('chatArchives')
              .withIndex('by_profile_thread', (q) =>
                q.eq('profileId', row.profileId).eq('threadId', threadId),
              )
              .unique(),
          ),
        )
        return archives.filter((archive) => !archive).length
      }),
    )
    return counts.reduce((total, count) => total + count, 0)
  },
})
export async function clearChatCounter(ctx: MutationCtx, profileId: Id<'profiles'>): Promise<void> {
  const row = await ctx.db
    .query('chatCounters')
    .withIndex('by_profile', (q) => q.eq('profileId', profileId))
    .unique()
  if (row) await ctx.db.delete(row._id)
}
export async function setChatCounterEnabled(
  ctx: MutationCtx,
  profileId: Id<'profiles'>,
  enabled: boolean,
): Promise<void> {
  const row = await ctx.db
    .query('chatCounters')
    .withIndex('by_profile', (q) => q.eq('profileId', profileId))
    .unique()
  if (row && row.enabled !== enabled) await ctx.db.patch(row._id, { enabled })
}
export const saveUnreadCount = internalMutation({
  args: { profileId: v.id('profiles'), token: v.string(), unreadThreadIds: v.array(v.string()) },
  handler: async (ctx, { profileId, token, unreadThreadIds }) => {
    if (
      unreadThreadIds.length > 200 ||
      unreadThreadIds.some((id) => !/^\d{1,40}$/.test(id)) ||
      new Set(unreadThreadIds).size !== unreadThreadIds.length
    )
      throw new Error('Invalid unread conversation IDs')
    unreadThreadIds.sort()
    const unreadCount = unreadThreadIds.length
    const session = await ctx.db
      .query('chatSessions')
      .withIndex('by_profile', (q) => q.eq('profileId', profileId))
      .unique()
    if (!session || session.token !== token)
      throw new DomainError('CONFLICT', 'Chat session changed')
    const existing = await ctx.db
      .query('chatCounters')
      .withIndex('by_profile', (q) => q.eq('profileId', profileId))
      .unique()
    const profile = await ctx.db.get(profileId)
    const enabled = Boolean(profile?.igLoggedIn && profile.status !== 'deleting')
    if (
      existing?.token === token &&
      existing.enabled === enabled &&
      JSON.stringify(existing.unreadThreadIds) === JSON.stringify(unreadThreadIds)
    )
      return
    if (existing) await ctx.db.patch(existing._id, { token, unreadCount, unreadThreadIds, enabled })
    else
      await ctx.db.insert('chatCounters', {
        profileId,
        token,
        unreadCount,
        unreadThreadIds,
        enabled,
      })
  },
})

/** Run after upgrading the server; removes retired message caches, never login sessions. */
export const retireHistory = internalMutation({
  args: { table: v.union(v.literal('chatThreads'), v.literal('chatHistories')) },
  handler: async (ctx, { table }) => {
    // Retired tables deliberately have no current schema or runtime readers.
    const db = ctx.db as GenericDatabaseWriter<GenericDataModel>
    const batch = await db
      .query(table)
      .paginate({ cursor: null, numItems: 25, maximumBytesRead: 512 * 1024 })
    for (const row of batch.page) await db.delete(row._id as GenericId<string>)
    return { deleted: batch.page.length, isDone: batch.isDone }
  },
})
