import type { HttpRouter } from 'convex/server';
import { internal } from '../_generated/api';
import {
  jsonResponse,
  parseBody,
  registerPreflight,
  withErrorHandling,
  ValidationError,
} from './shared';

const internalApi = internal as any;

const scrapeJobPaths = [
  '/api/scrape-jobs',
  '/api/scrape-jobs/by-id',
  '/api/scrape-jobs/create',
  '/api/scrape-jobs/update',
  '/api/scrape-jobs/remove',
  '/api/scrape-jobs/start',
  '/api/scrape-jobs/finish',
  '/api/scrape-jobs/update-stats',
  '/api/scrape-jobs/reconcile',
];

export function registerScrapeJobRoutes(http: HttpRouter): void {
  registerPreflight(http, scrapeJobPaths);

  http.route({
    path: '/api/scrape-jobs/reconcile',
    method: 'POST',
    handler: withErrorHandling(async (ctx) => {
      const result = await ctx.runMutation(internalApi.scrapeJobs.reconcileInterruptedInternal, {});
      return jsonResponse(result);
    }),
  });

  http.route({
    path: '/api/scrape-jobs',
    method: 'GET',
    handler: withErrorHandling(async (ctx) => {
      const rows = await ctx.runQuery(internalApi.scrapeJobs.listInternal, {});
      return jsonResponse(rows);
    }),
  });

  http.route({
    path: '/api/scrape-jobs/by-id',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const jobId = url.searchParams.get('jobId') || '';
      if (!jobId) throw new ValidationError('jobId is required');
      const row = await ctx.runQuery(internalApi.scrapeJobs.getInternal, { id: jobId as any });
      return jsonResponse(row);
    }),
  });

  http.route({
    path: '/api/scrape-jobs/create',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const row = await ctx.runMutation(internalApi.scrapeJobs.createInternal, {
        name: body?.name ?? '',
        targets: body?.targets,
        listIds: body?.listIds,
        config: body?.config,
      });
      return jsonResponse(row);
    }),
  });

  http.route({
    path: '/api/scrape-jobs/update',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      if (!body?.id) throw new ValidationError('id is required');
      const row = await ctx.runMutation(internalApi.scrapeJobs.updateInternal, {
        id: body.id as any,
        name: body?.name,
        targets: body?.targets,
        listIds: body?.listIds,
        config: body?.config,
      });
      return jsonResponse(row);
    }),
  });

  http.route({
    path: '/api/scrape-jobs/remove',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      if (!body?.id) throw new ValidationError('id is required');
      const row = await ctx.runMutation(internalApi.scrapeJobs.removeInternal, {
        id: body.id as any,
      });
      return jsonResponse(row);
    }),
  });

  http.route({
    path: '/api/scrape-jobs/start',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      if (!body?.id) throw new ValidationError('id is required');
      const row = await ctx.runMutation(internalApi.scrapeJobs.startInternal, { id: body.id as any });
      return jsonResponse(row);
    }),
  });

  http.route({
    path: '/api/scrape-jobs/finish',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      if (!body?.id) throw new ValidationError('id is required');
      const row = await ctx.runMutation(internalApi.scrapeJobs.finishInternal, {
        id: body.id as any,
        status: body?.status,
        error: body?.error,
        stats: body?.stats,
      });
      return jsonResponse(row);
    }),
  });

  http.route({
    path: '/api/scrape-jobs/update-stats',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      if (!body?.id) throw new ValidationError('id is required');
      const row = await ctx.runMutation(internalApi.scrapeJobs.updateStatsInternal, {
        id: body.id as any,
        stats: body?.stats ?? {},
      });
      return jsonResponse(row);
    }),
  });
}
