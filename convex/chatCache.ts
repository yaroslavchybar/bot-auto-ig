import { v } from 'convex/values'
import type { GenericId } from 'convex/values'
import { internalMutation, query, type MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { GenericDatabaseWriter, GenericDataModel } from 'convex/server'
import { DomainError } from './errors'

// Reads only tiny counters; session refreshes and cookies cannot invalidate this query.
export const unreadCount = query({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query('chatCounters').collect()).reduce(
      (count, row) => count + (row.enabled ? row.unreadCount : 0),
      0,
    ),
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
  args: { profileId: v.id('profiles'), token: v.string(), unreadCount: v.number() },
  handler: async (ctx, { profileId, token, unreadCount }) => {
    if (!Number.isSafeInteger(unreadCount) || unreadCount < 0 || unreadCount > 200)
      throw new Error('Invalid unread count')
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
    if (existing?.token === token && existing.unreadCount === unreadCount) return
    const profile = await ctx.db.get(profileId)
    const enabled = Boolean(profile?.igLoggedIn && profile.status !== 'deleting')
    if (existing) await ctx.db.patch(existing._id, { token, unreadCount, enabled })
    else await ctx.db.insert('chatCounters', { profileId, token, unreadCount, enabled })
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
