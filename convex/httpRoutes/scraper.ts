import type { HttpRouter } from 'convex/server'
import type { Id } from '../_generated/dataModel'
import { api, internal } from '../_generated/api'
import { jsonResponse, parseBody, registerPreflight, withErrorHandling } from './shared'

const paths = [
  'initialize',
  'enrichment-batch',
  'claim',
  'heartbeat',
  'posts',
  'batch',
  'pending',
  'picture-description',
  'enrich',
  'enrichment-error',
  'finish',
  'accounts',
  'cooldown',
]

/** Server-only bridge. The HTTP wrapper verifies INTERNAL_API_KEY. */
export function registerScraperRoutes(http: HttpRouter): void {
  http.route({
    path: '/api/mobile-requests/reserve',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request)
      return jsonResponse(
        await ctx.runMutation(internal.mobileRequests.reserve, {
          profileId: body.profileId,
          requestId: body.requestId,
          kind: body.kind,
        }),
      )
    }),
  })
  registerPreflight(
    http,
    paths.map((path) => `/api/scraper/${path}`),
  )
  http.route({
    path: '/api/scraper/enrichment-batch',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request)
      await ctx.runMutation(internal.scraper.saveEnrichmentBatch, { entries: body.entries })
      return jsonResponse({ ok: true })
    }),
  })
  http.route({
    path: '/api/scraper/initialize',
    method: 'POST',
    handler: withErrorHandling(async (ctx) => {
      await ctx.runMutation(internal.workerMetadata.initialize, {})
      return jsonResponse({ ok: true })
    }),
  })
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
        postsFromApify: b.postsFromApify,
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
    path: '/api/scraper/pending',
    method: 'POST',
    handler: withErrorHandling(async (ctx) =>
      jsonResponse(await ctx.runQuery(internal.scraper.pendingLeads, {})),
    ),
  })
  http.route({
    path: '/api/scraper/picture-description',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const b = await parseBody(request)
      await ctx.runMutation(internal.scraper.savePictureDescription, {
        leadId: b.leadId as Id<'leads'>,
        description: b.description,
      })
      return jsonResponse({ ok: true })
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
    path: '/api/scraper/enrich',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const b = await parseBody(request)
      await ctx.runMutation(internal.scraper.enrich, {
        leadId: b.leadId as Id<'leads'>,
        profilePicDescription: b.profilePicDescription,
        classification: b.classification,
      })
      return jsonResponse({ ok: true })
    }),
  })
  http.route({
    path: '/api/scraper/enrichment-error',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const b = await parseBody(request)
      await ctx.runMutation(internal.scraper.enrichmentError, { leadId: b.leadId as Id<'leads'> })
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
