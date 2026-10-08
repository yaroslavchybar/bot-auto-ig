import { v } from 'convex/values'
import { internalQuery } from '../_generated/server'
import { query } from '../_generated/server'
import { requireServerBridgeAuth } from '../serverBridgeAuth'
import { internal } from '../_generated/api'
import type { Doc } from '../_generated/dataModel'
import {
  scanPage,
  matchesSearch,
  SCAN_BATCH_BYTES,
  type CursorPage,
} from '../../server/shared/pagination'

export type ProfileListRow = Pick<
  Doc<'profiles'>,
  | '_id'
  | 'name'
  | 'proxy'
  | 'proxyType'
  | 'fingerprintOs'
  | 'status'
  | 'using'
  | 'renameFrom'
  | 'igLoggedIn'
  | 'outreachReady'
>

export const listBatchInternal = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), count: v.number() },
  handler: async (ctx, { cursor, count }): Promise<CursorPage<ProfileListRow>> => {
    const result = await ctx.db
      .query('profiles')
      .withIndex('by_created')
      .paginate({ cursor, numItems: count, maximumBytesRead: SCAN_BATCH_BYTES })
    return {
      ...result,
      page: result.page.map(
        ({
          _id,
          name,
          proxy,
          proxyType,
          fingerprintOs,
          status,
          using,
          renameFrom,
          igLoggedIn,
          outreachReady,
        }) => ({
          _id,
          name,
          proxy,
          proxyType,
          fingerprintOs,
          status,
          using,
          renameFrom,
          igLoggedIn,
          outreachReady,
        }),
      ),
    }
  },
})

export const listPage = query({
  args: { search: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { search, cursor }): Promise<CursorPage<ProfileListRow>> => {
    const term = search.trim().toLowerCase()
    return scanPage<ProfileListRow>(
      (next, count) =>
        ctx.runQuery(internal.profiles.queries.listBatchInternal, { cursor: next, count }),
      (row) =>
        matchesSearch(term, [
          row.name,
          row._id,
          row.proxy,
          row.proxyType,
          row.fingerprintOs,
          row.using ? 'active' : (row.status ?? 'idle'),
        ]),
      cursor,
    )
  },
})

export const maintenanceWork = query({
  args: { bridgeToken: v.string() },
  handler: async (ctx, { bridgeToken }) => {
    requireServerBridgeAuth(bridgeToken)
    const [deleting, renaming] = await Promise.all([
      ctx.db
        .query('profiles')
        .withIndex('by_status', (q) => q.eq('status', 'deleting'))
        .take(100),
      ctx.db
        .query('profiles')
        .withIndex('by_rename', (q) => q.gt('renameFrom', undefined))
        .take(100),
    ])
    return [...new Set([...deleting, ...renaming].map((p) => p._id))]
  },
})

/** Server-only revisions: session bytes stay in storage and are fetched only after changes. */
export const chatWorkerContexts = query({
  args: { bridgeToken: v.string(), subscriptionId: v.string() },
  handler: async (ctx, { bridgeToken }) => {
    requireServerBridgeAuth(bridgeToken)
    const memberships = await ctx.db.query('chatMemberships').take(1001)
    if (memberships.length > 1000) throw new Error('Too many connected Chat accounts')
    const contexts = await Promise.all(
      memberships.map(async ({ profileId }) => {
        const [profile, session] = await Promise.all([
          ctx.db.get(profileId),
          ctx.db
            .query('chatSessions')
            .withIndex('by_profile', (q) => q.eq('profileId', profileId))
            .first(),
        ])
        if (!profile || profile.status === 'deleting' || !session) return null
        return {
          profileId,
          token: session.token,
          storageId: session.storageId,
          reconnectRequired: session.reconnectRequired === true,
          enabled: profile.igLoggedIn === true && session.reconnectRequired !== true,
          proxy: profile.proxy ?? '',
          proxyType: profile.proxyType ?? '',
        }
      }),
    )
    return contexts
      .filter((context) => context !== null)
      .sort((a, b) => a.profileId.localeCompare(b.profileId))
  },
})
import {
  listProfileRows,
  getProfileByNameRow,
  getAvailableProfilesForLists,
  getProfilesByListIds,
  listAssignedProfilesRow,
  listUnassignedProfilesRow,
  normalizeProfileRow,
} from './helpers'

export const listInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await listProfileRows(ctx)
  },
})

export const getByIdInternal = internalQuery({
  args: { profileId: v.id('profiles') },
  handler: async (ctx, args) => {
    return normalizeProfileRow((await ctx.db.get(args.profileId)) ?? null)
  },
})

export const list = query({
  args: {},
  handler: async (ctx) => {
    return (await listProfileRows(ctx)).map(
      ({ sessionId: _sessionId, cookiesJson: _cookiesJson, ...row }: any) => row,
    )
  },
})

export const getByNameInternal = internalQuery({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    return await getProfileByNameRow(ctx, args.name)
  },
})

export const getById = query({
  args: { profileId: v.id('profiles') },
  handler: async (ctx, args) => {
    const row = normalizeProfileRow((await ctx.db.get(args.profileId)) ?? null)
    if (!row) return null
    const { sessionId: _sessionId, ...publicRow } = row
    return publicRow
  },
})

export const getChatSessionInternal = internalQuery({
  args: { profileId: v.id('profiles') },
  handler: async (ctx, { profileId }) =>
    ctx.db
      .query('chatSessions')
      .withIndex('by_profile', (q) => q.eq('profileId', profileId))
      .first(),
})

/** Read session metadata and its proxy configuration in the same database snapshot. */
export const getChatContextInternal = internalQuery({
  args: { profileId: v.id('profiles') },
  handler: async (ctx, { profileId }) => {
    const [profile, session] = await Promise.all([
      ctx.db.get(profileId),
      ctx.db
        .query('chatSessions')
        .withIndex('by_profile', (q) => q.eq('profileId', profileId))
        .first(),
    ])
    return {
      profile: profile ? { proxy: profile.proxy ?? '', proxyType: profile.proxyType ?? '' } : null,
      session,
    }
  },
})

export const getAvailableForListsInternal = internalQuery({
  args: {
    listIds: v.array(v.string()),
    cooldownMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    return await getAvailableProfilesForLists(ctx, args.listIds, args.cooldownMinutes)
  },
})

export const getByListIdsInternal = internalQuery({
  args: {
    listIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    return await getProfilesByListIds(ctx, args.listIds)
  },
})

export const listAssignedInternal = internalQuery({
  args: { listId: v.id('lists') },
  handler: async (ctx, args) => {
    return await listAssignedProfilesRow(ctx, args.listId)
  },
})

export const listUnassignedInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await listUnassignedProfilesRow(ctx)
  },
})

// Model membership UI needs no proxy, cookie, or browser runtime fields.
export const modelOptions = query({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query('profiles').collect()).map(
      ({ _id, name, status, igLoggedIn, listIds }) => ({ _id, name, status, igLoggedIn, listIds }),
    ),
})

// The Chat selector needs every eligible profile, without browser configuration or cookies.
export const chatOptions = query({
  args: {},
  handler: async (ctx) =>
    (
      await ctx.db
        .query('profiles')
        .withIndex('by_chat', (q) => q.eq('igLoggedIn', true))
        .collect()
    )
      .filter((profile) => profile.igLoggedIn && profile.status !== 'deleting')
      .map(({ _id, name, status }) => ({ _id, name, status })),
})
