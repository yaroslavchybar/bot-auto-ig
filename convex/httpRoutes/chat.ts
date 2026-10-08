import type { HttpRouter } from 'convex/server'
import type { Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import {
  jsonResponse,
  parseBody,
  registerPreflight,
  ValidationError,
  withErrorHandling,
} from './shared'

const profileIdFrom = (value: unknown): Id<'profiles'> => {
  if (typeof value !== 'string' || !value.trim())
    throw new ValidationError('Profile ID is required')
  return value as Id<'profiles'>
}

export function registerChatRoutes(http: HttpRouter): void {
  registerPreflight(http, [
    '/api/chat/session',
    '/api/chat/context',
    '/api/chat/count',
    '/api/chat/archives',
  ])
  http.route({
    path: '/api/chat/archives',
    method: 'GET',
    handler: withErrorHandling(async (ctx) =>
      jsonResponse(await ctx.runQuery(internal.chatArchives.list, {})),
    ),
  })
  http.route({
    path: '/api/chat/archives',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request)
      if (typeof body.threadId !== 'string' || typeof body.archived !== 'boolean')
        throw new ValidationError('Invalid archive status')
      await ctx.runMutation(internal.chatArchives.setArchived, {
        profileId: profileIdFrom(body.profileId),
        threadId: body.threadId,
        archived: body.archived,
      })
      return jsonResponse(await ctx.runQuery(internal.chatArchives.list, {}))
    }),
  })
  http.route({
    path: '/api/chat/context',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const profileId = profileIdFrom(new URL(request.url).searchParams.get('profileId'))
      const { profile, session } = await ctx.runQuery(
        internal.profiles.queries.getChatContextInternal,
        { profileId },
      )
      if (!profile || !session) return jsonResponse({ connected: false, profile })
      const blob = await ctx.storage.get(session.storageId)
      if (!blob) throw new Error('Chat session file is missing')
      return jsonResponse({
        connected: true,
        state: await blob.text(),
        token: session.token,
        profile,
      })
    }),
  })
  http.route({
    path: '/api/chat/count',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request)
      const profileId = profileIdFrom(body.profileId)
      if (
        typeof body.token !== 'string' ||
        !Number.isSafeInteger(body.unreadCount) ||
        body.unreadCount < 0 ||
        body.unreadCount > 200
      )
        throw new ValidationError('Invalid unread count')
      await ctx.runMutation(internal.chatCache.saveUnreadCount, {
        profileId,
        token: body.token,
        unreadCount: body.unreadCount,
      })
      return jsonResponse({ saved: true })
    }),
  })
  http.route({
    path: '/api/chat/session',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const profileId = profileIdFrom(new URL(request.url).searchParams.get('profileId'))
      const row = await ctx.runQuery(internal.profiles.queries.getChatSessionInternal, {
        profileId,
      })
      if (!row) return jsonResponse({ connected: false })
      if (new URL(request.url).searchParams.get('status') === '1')
        return jsonResponse({
          connected: row.reconnectRequired !== true,
          reconnectRequired: row.reconnectRequired === true,
        })
      const blob = await ctx.storage.get(row.storageId)
      if (!blob) throw new Error('Chat session file is missing')
      return jsonResponse({ connected: true, state: await blob.text(), token: row.token })
    }),
  })

  http.route({
    path: '/api/chat/session',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request)
      const profileId = profileIdFrom(body.profileId)
      if (
        typeof body.state !== 'string' ||
        body.state.length > 250_000 ||
        typeof body.token !== 'string' ||
        !/^[a-f\d-]{36}$/i.test(body.token) ||
        (body.expectedToken !== undefined && typeof body.expectedToken !== 'string')
      ) {
        throw new ValidationError('Invalid Chat session')
      }
      let sessionVersion: 1 | undefined
      try {
        if (JSON.parse(body.state)?.version === 1) sessionVersion = 1
      } catch {
        /* Older SDK session. */
      }
      const storageId = await ctx.storage.store(
        new Blob([body.state], { type: 'application/json' }),
      )
      try {
        await ctx.runMutation(internal.profiles.mutations.saveChatSessionInternal, {
          profileId,
          storageId,
          token: body.token,
          expectedToken: body.expectedToken,
          sessionVersion,
          reconnectRequired: body.reconnectRequired === true,
        })
        return jsonResponse({ connected: true })
      } catch (error) {
        await ctx.storage.delete(storageId)
        throw error
      }
    }),
  })

  http.route({
    path: '/api/chat/session',
    method: 'DELETE',
    handler: withErrorHandling(async (ctx, request) => {
      const profileId = profileIdFrom(new URL(request.url).searchParams.get('profileId'))
      await ctx.runMutation(internal.profiles.mutations.deleteChatSessionInternal, { profileId })
      return jsonResponse({ connected: false })
    }),
  })
}
