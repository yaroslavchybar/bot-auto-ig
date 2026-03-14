import type { HttpRouter } from 'convex/server';
import { api } from '../_generated/api';
import {
  jsonResponse,
  mapListToPython,
  parseBody,
  registerPreflight,
  withErrorHandling,
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
    handler: withErrorHandling(async (ctx) => {
      const lists = await ctx.runQuery(api.lists.list, {});
      return jsonResponse(lists.map(mapListToPython));
    }),
  });

  http.route({
    path: '/api/lists',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const created = await ctx.runMutation(api.lists.create, body as any);
      return jsonResponse(mapListToPython(created));
    }),
  });

  http.route({
    path: '/api/lists/update',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const updated = await ctx.runMutation(api.lists.update, body as any);
      return jsonResponse(mapListToPython(updated));
    }),
  });

  http.route({
    path: '/api/lists/remove',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const ok = await ctx.runMutation(api.lists.remove, body as any);
      return jsonResponse({ ok });
    }),
  });

  // Alias for /api/lists/remove
  http.route({
    path: '/api/lists/delete',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const ok = await ctx.runMutation(api.lists.remove, body as any);
      return jsonResponse({ ok });
    }),
  });
}
