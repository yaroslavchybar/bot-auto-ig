import type { HttpRouter } from 'convex/server';
import { api } from '../_generated/api';
import { httpAction } from '../_generated/server';
import {
  jsonResponse,
  mapListToPython,
  parseBody,
  registerPreflight,
  requireAuth,
} from './shared';

const listPaths = [
  '/api/lists',
  '/api/lists/update',
  '/api/lists/remove',
  '/api/lists/delete',
];

export function registerListRoutes(http: HttpRouter): void {
  registerPreflight(http, listPaths);

  http.route({
    path: '/api/lists',
    method: 'GET',
    handler: httpAction(async (ctx, request) => {
      const authError = await requireAuth(request);
      if (authError) return authError;
      try {
        const lists = await ctx.runQuery(api.lists.list, {});
        return jsonResponse(lists.map(mapListToPython));
      } catch (err: any) {
        return jsonResponse({ error: String(err?.message || err) }, 400);
      }
    }),
  });

  http.route({
    path: '/api/lists',
    method: 'POST',
    handler: httpAction(async (ctx, request) => {
      const authError = await requireAuth(request);
      if (authError) return authError;
      try {
        const body = await parseBody(request);
        const created = await ctx.runMutation(api.lists.create, body as any);
        return jsonResponse(mapListToPython(created));
      } catch (err: any) {
        return jsonResponse({ error: String(err?.message || err) }, 400);
      }
    }),
  });

  http.route({
    path: '/api/lists/update',
    method: 'POST',
    handler: httpAction(async (ctx, request) => {
      const authError = await requireAuth(request);
      if (authError) return authError;
      try {
        const body = await parseBody(request);
        const updated = await ctx.runMutation(api.lists.update, body as any);
        return jsonResponse(mapListToPython(updated));
      } catch (err: any) {
        return jsonResponse({ error: String(err?.message || err) }, 400);
      }
    }),
  });

  http.route({
    path: '/api/lists/remove',
    method: 'POST',
    handler: httpAction(async (ctx, request) => {
      const authError = await requireAuth(request);
      if (authError) return authError;
      try {
        const body = await parseBody(request);
        const ok = await ctx.runMutation(api.lists.remove, body as any);
        return jsonResponse({ ok });
      } catch (err: any) {
        return jsonResponse({ error: String(err?.message || err) }, 400);
      }
    }),
  });

  // Alias for /api/lists/remove
  http.route({
    path: '/api/lists/delete',
    method: 'POST',
    handler: httpAction(async (ctx, request) => {
      const authError = await requireAuth(request);
      if (authError) return authError;
      try {
        const body = await parseBody(request);
        const ok = await ctx.runMutation(api.lists.remove, body as any);
        return jsonResponse({ ok });
      } catch (err: any) {
        return jsonResponse({ error: String(err?.message || err) }, 400);
      }
    }),
  });
}
