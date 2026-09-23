import type { HttpRouter } from 'convex/server';
import type { Id } from '../_generated/dataModel';
import { api, internal } from '../_generated/api';
import { jsonResponse, parseBody, registerPreflight, withErrorHandling } from './shared';

const paths = ['claim', 'checkpoint', 'batch', 'pending', 'picture-description', 'enrich', 'enrichment-error', 'finish', 'accounts', 'cooldown'];

/** Server-only bridge. The HTTP wrapper verifies INTERNAL_API_KEY. */
export function registerScraperRoutes(http: HttpRouter): void {
  registerPreflight(http, paths.map(path => `/api/scraper/${path}`));
  http.route({ path: '/api/scraper/claim', method: 'POST', handler: withErrorHandling(async ctx =>
    jsonResponse(await ctx.runMutation(internal.scraper.claimNext, {}))) });
  http.route({ path: '/api/scraper/checkpoint', method: 'POST', handler: withErrorHandling(async (ctx, request) => {
    const b = await parseBody(request);
    await ctx.runMutation(internal.scraper.checkpoint, {
      jobId: b.jobId as Id<'scrapeJobs'>, runId: b.runId,
      posts: b.posts, postIndex: b.postIndex,
    });
    return jsonResponse({ ok: true });
  }) });
  http.route({ path: '/api/scraper/batch', method: 'POST', handler: withErrorHandling(async (ctx, request) => {
    const b = await parseBody(request);
    return jsonResponse(await ctx.runMutation(internal.scraper.saveBatch, {
      jobId: b.jobId as Id<'scrapeJobs'>, runId: b.runId, likers: b.likers,
    }));
  }) });
  http.route({ path: '/api/scraper/pending', method: 'POST', handler: withErrorHandling(async ctx =>
    jsonResponse(await ctx.runQuery(internal.scraper.pendingLeads, {}))) });
  http.route({ path: '/api/scraper/picture-description', method: 'POST', handler: withErrorHandling(async (ctx, request) => {
    const b = await parseBody(request);
    await ctx.runMutation(internal.scraper.savePictureDescription, {
      leadId: b.leadId as Id<'leads'>, description: b.description,
    });
    return jsonResponse({ ok: true });
  }) });
  http.route({ path: '/api/scraper/accounts', method: 'POST', handler: withErrorHandling(async ctx =>
    jsonResponse(await ctx.runQuery(api.scraper.accounts, {}))) });
  http.route({ path: '/api/scraper/cooldown', method: 'POST', handler: withErrorHandling(async (ctx, request) => {
    const b = await parseBody(request);
    await ctx.runMutation(internal.scraper.cooldownAccount, {
      profileId: b.profileId as Id<'profiles'>, retryAfterMs: b.retryAfterMs,
    });
    return jsonResponse({ ok: true });
  }) });
  http.route({ path: '/api/scraper/enrich', method: 'POST', handler: withErrorHandling(async (ctx, request) => {
    const b = await parseBody(request);
    await ctx.runMutation(internal.scraper.enrich, {
      leadId: b.leadId as Id<'leads'>,
      profilePicDescription: b.profilePicDescription, classification: b.classification,
    });
    return jsonResponse({ ok: true });
  }) });
  http.route({ path: '/api/scraper/enrichment-error', method: 'POST', handler: withErrorHandling(async (ctx, request) => {
    const b = await parseBody(request);
    await ctx.runMutation(internal.scraper.enrichmentError, { leadId: b.leadId as Id<'leads'> });
    return jsonResponse({ ok: true });
  }) });
  http.route({ path: '/api/scraper/finish', method: 'POST', handler: withErrorHandling(async (ctx, request) => {
    const b = await parseBody(request);
    await ctx.runMutation(internal.scraper.finish, {
      jobId: b.jobId as Id<'scrapeJobs'>, runId: b.runId, status: b.status, error: b.error,
    });
    return jsonResponse({ ok: true });
  }) });
}
