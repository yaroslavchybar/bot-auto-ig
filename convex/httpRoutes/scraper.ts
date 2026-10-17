import type { HttpRouter } from 'convex/server'
import type { Id } from '../_generated/dataModel'
import { api, internal } from '../_generated/api'
import {
  jsonResponse,
  parseBody,
  registerPreflight,
  withErrorHandling,
  ValidationError,
} from './shared'

const paths = ['claim', 'heartbeat', 'posts', 'batch', 'finish', 'accounts', 'cooldown']

/** Server-only bridge. The HTTP wrapper verifies INTERNAL_API_KEY. */
export function registerScraperRoutes(http: HttpRouter): void {
  http.route({
    path: '/api/scraper/requests/reserve',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request)
      if (typeof body.sourceId !== 'string' || typeof body.runId !== 'string')
        throw new ValidationError('A scraper source lease is required')
      return jsonResponse(
        await ctx.runMutation(internal.scraperRequests.reserve, {
          profileId: body.profileId,
          requestId: body.requestId,
          sourceId: body.sourceId as Id<'scrapeSources'>,
          runId: body.runId,
        }),
      )
    }),
  })
  registerPreflight(
    http,
    paths.map((path) => `/api/scraper/${path}`),
  )
  http.route({
    path: '/api/scraper/claim',
    method: 'POST',
    handler: withErrorHandling(async (ctx) =>
      jsonResponse(await ctx.runMutation(internal.scrapeSources.claim, {})),
    ),
  })
  http.route({
    path: '/api/scraper/heartbeat',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const b = await parseBody(request)
      await ctx.runMutation(internal.scrapeSources.heartbeat, {
        sourceId: b.sourceId as Id<'scrapeSources'>,
        runId: b.runId,
      })
      return jsonResponse({ ok: true })
    }),
  })
  http.route({
    path: '/api/scraper/posts',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const b = await parseBody(request)
      await ctx.runMutation(internal.scrapeSources.registerPosts, {
        sourceId: b.sourceId as Id<'scrapeSources'>,
        runId: b.runId,
        posts: b.posts.map(
          (p: { id: string; code: string; takenAt: number; likeCount?: number | null }) => ({
            ...p,
            likeCount: p.likeCount ?? undefined,
          }),
        ),
        averageLikes: b.averageLikes ?? undefined,
        postCount: b.postCount,
      })
      return jsonResponse({ ok: true })
    }),
  })
  http.route({
    path: '/api/scraper/batch',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const b = await parseBody(request)
      return jsonResponse(
        await ctx.runMutation(internal.scraper.saveBatch, {
          sourceId: b.sourceId as Id<'scrapeSources'>,
          runId: b.runId,
          likers: b.likers,
        }),
      )
    }),
  })
  http.route({
    path: '/api/scraper/accounts',
    method: 'POST',
    handler: withErrorHandling(async (ctx) =>
      jsonResponse(await ctx.runQuery(api.scraper.accounts, {})),
    ),
  })
  http.route({
    path: '/api/scraper/cooldown',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const b = await parseBody(request)
      await ctx.runMutation(internal.scraper.cooldownAccount, {
        profileId: b.profileId as Id<'profiles'>,
        retryAfterMs: b.retryAfterMs,
      })
      return jsonResponse({ ok: true })
    }),
  })
  http.route({
    path: '/api/scraper/finish',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const b = await parseBody(request)
      await ctx.runMutation(internal.scrapeSources.finish, {
        sourceId: b.sourceId as Id<'scrapeSources'>,
        runId: b.runId,
        status: b.status,
        error: b.error,
        newIds: b.newIds,
        likeCount: b.likeCount ?? undefined,
      })
      return jsonResponse({ ok: true })
    }),
  })
}
