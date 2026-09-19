import type { HttpRouter } from 'convex/server';
import { internal } from '../_generated/api';
import {
  jsonResponse,
  parseBody,
  registerPreflight,
  withErrorHandling,
  ValidationError,
} from './shared';

const warmupPaths = [
  '/api/warmup/states',
  '/api/warmup/by-profile',
  '/api/warmup/record',
];

export function registerWarmupRoutes(http: HttpRouter): void {
  registerPreflight(http, warmupPaths);

  http.route({
    path: '/api/warmup/states',
    method: 'GET',
    handler: withErrorHandling(async (ctx) => {
      return jsonResponse(await ctx.runQuery(internal.warmup.queries.listInternal, {}));
    }),
  });

  http.route({
    path: '/api/warmup/by-profile',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const profileId = url.searchParams.get('profileId') || '';
      if (!profileId) throw new ValidationError('profileId is required');
      return jsonResponse(await ctx.runQuery(internal.warmup.queries.getByProfileInternal, {
        profileId: profileId as any,
      }));
    }),
  });

  http.route({
    path: '/api/warmup/record',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      if (!body?.profileId) throw new ValidationError('profileId is required');
      if (!body?.automationId) throw new ValidationError('automationId is required');
      const minutes = Number(body?.minutes);
      if (!Number.isFinite(minutes) || minutes <= 0) throw new ValidationError('minutes must be a positive number');
      if (!body?.runId) throw new ValidationError('runId is required');
      return jsonResponse(await ctx.runMutation(internal.warmup.mutations.recordRunInternal, {
        profileId: body.profileId as any,
        automationId: String(body.automationId),
        minutes,
        runId: String(body.runId),
      }));
    }),
  });
}
