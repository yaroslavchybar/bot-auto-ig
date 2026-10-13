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

export function registerMobileRoutes(http: HttpRouter): void {
  registerPreflight(http, [
    '/api/mobile/session',
    '/api/mobile/context',
  ])
  http.route({
    path: '/api/mobile/context',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const profileId = profileIdFrom(new URL(request.url).searchParams.get('profileId'))
      const { profile, session } = await ctx.runQuery(
        internal.profiles.queries.getMobileContextInternal,
        { profileId },
      )
      if (!profile || !session) return jsonResponse({ connected: false, profile })
      const blob = await ctx.storage.get(session.storageId)
      if (!blob) throw new Error('Mobile session file is missing')
      return jsonResponse({
        connected: true,
        state: await blob.text(),
        token: session.token,
        storageId: session.storageId,
        reconnectRequired: session.reconnectRequired === true,
        profile,
      })
    }),
  })
  http.route({
    path: '/api/mobile/session',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const profileId = profileIdFrom(new URL(request.url).searchParams.get('profileId'))
      const row = await ctx.runQuery(internal.profiles.queries.getMobileSessionInternal, {
        profileId,
      })
      if (!row) return jsonResponse({ connected: false })
      if (new URL(request.url).searchParams.get('status') === '1')
        return jsonResponse({
          connected: row.reconnectRequired !== true,
          reconnectRequired: row.reconnectRequired === true,
        })
      const blob = await ctx.storage.get(row.storageId)
      if (!blob) throw new Error('Mobile session file is missing')
      return jsonResponse({ connected: true, state: await blob.text(), token: row.token })
    }),
  })

  http.route({
    path: '/api/mobile/session',
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
        throw new ValidationError('Invalid Mobile session')
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
        await ctx.runMutation(internal.profiles.mutations.saveMobileSessionInternal, {
          profileId,
          storageId,
          token: body.token,
          expectedToken: body.expectedToken,
          sessionVersion,
          reconnectRequired: body.reconnectRequired === true,
        })
        return jsonResponse({ connected: true, storageId })
      } catch (error) {
        await ctx.storage.delete(storageId)
        throw error
      }
    }),
  })

  http.route({
    path: '/api/mobile/session',
    method: 'DELETE',
    handler: withErrorHandling(async (ctx, request) => {
      const profileId = profileIdFrom(new URL(request.url).searchParams.get('profileId'))
      await ctx.runMutation(internal.profiles.mutations.deleteMobileSessionInternal, { profileId })
      return jsonResponse({ connected: false })
    }),
  })
}
