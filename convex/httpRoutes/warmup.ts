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
  '/api/warmup/begin',
  '/api/warmup/finish',
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
    path: '/api/warmup/begin',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      if (!body?.profileId) throw new ValidationError('profileId is required');
      if (!body?.automationId) throw new ValidationError('automationId is required');
      if (!body?.runId) throw new ValidationError('runId is required');
      const minMinutes = Number(body.minMinutes);
      const maxMinutes = Number(body.maxMinutes);
      const sessionMinMinutes = Number(body.sessionMinMinutes);
      const sessionMaxMinutes = Number(body.sessionMaxMinutes);
      const restMinMinutes = Number(body.restMinMinutes);
      const restMaxMinutes = Number(body.restMaxMinutes);
      for (const [min, max, floor] of [[minMinutes, maxMinutes, 1], [sessionMinMinutes, sessionMaxMinutes, 1], [restMinMinutes, restMaxMinutes, 0]]) {
        if (!Number.isFinite(min) || min < floor || !Number.isFinite(max) || max < min)
          throw new ValidationError('Invalid warm-up minute range');
      }
      return jsonResponse(await ctx.runMutation(internal.warmup.mutations.beginRunInternal, {
        profileId: body.profileId as any,
        automationId: String(body.automationId),
        minMinutes, maxMinutes,
        sessionMinMinutes, sessionMaxMinutes, restMinMinutes, restMaxMinutes,
        runId: String(body.runId),
      }));
    }),
  });

  http.route({
    path: '/api/warmup/finish', method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const minutes = Number(body?.minutes);
      if (!body?.profileId || !body?.runId || !/^\d{4}-\d{2}-\d{2}$/.test(String(body?.date)))
        throw new ValidationError('profileId, runId and date are required');
      if (!Number.isFinite(minutes) || minutes < 0) throw new ValidationError('Invalid elapsed minutes');
      await ctx.runMutation(internal.warmup.mutations.finishRunInternal, {
        profileId: body.profileId as any, runId: String(body.runId), date: String(body.date), minutes,
      });
      return jsonResponse({ ok: true });
    }),
  });
}
