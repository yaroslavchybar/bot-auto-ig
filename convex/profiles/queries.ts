import { v } from 'convex/values'
import { internalQuery } from '../_generated/server'
import { query } from '../_generated/server'
import { requireServerBridgeAuth } from '../serverBridgeAuth'
import { internal } from '../_generated/api'
import type { Doc } from '../_generated/dataModel'
import {
  scanPage,
  matchesSearch,
  isPageSize,
  SCAN_BATCH_BYTES,
  type CursorPage,
} from '../../server/shared/pagination'
import { DomainError } from '../errors'

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
  | 'paused'
  | 'unreadChatCount'
  | 'unreadChatsCheckedAt'
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
          paused,
          unreadChatCount,
          unreadChatsCheckedAt,
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
          paused,
          unreadChatCount,
          unreadChatsCheckedAt,
        }),
      ),
    }
  },
})

export const listPage = query({
  args: {
    search: v.string(),
    cursor: v.union(v.string(), v.null()),
    pageSize: v.number(),
  },
  handler: async (ctx, { search, cursor, pageSize }): Promise<CursorPage<ProfileListRow>> => {
    if (!isPageSize(pageSize)) throw new DomainError('VALIDATION', 'Invalid page size')
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
      pageSize,
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
    const cleanup = await ctx.db.query('modelContentCleanup').take(100)
    return {
      profileIds: [...new Set([...deleting, ...renaming].map((p) => p._id))],
      modelIds: cleanup.map((row) => row.modelId),
    }
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

/** Live permission for graph workers; pausing closes their automated browser session. */
export const automationAccess = query({
  args: { bridgeToken: v.string(), profileId: v.id('profiles') },
  handler: async (ctx, { bridgeToken, profileId }) => {
    requireServerBridgeAuth(bridgeToken)
    const profile = await ctx.db.get(profileId)
    return Boolean(
      profile && !profile.paused && profile.status !== 'deleting' && !profile.renameFrom,
    )
  },
})
