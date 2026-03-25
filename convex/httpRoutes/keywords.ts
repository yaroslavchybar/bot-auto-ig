import type { HttpRouter } from 'convex/server';
import { internal } from '../_generated/api';
import { jsonResponse, parseBody, registerPreflight, withErrorHandling } from './shared';

const keywordPaths = ['/api/keywords', '/api/keywords/delete'];

export function registerKeywordRoutes(http: HttpRouter): void {
  registerPreflight(http, keywordPaths);

  http.route({
    path: '/api/keywords',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const filename = (url.searchParams.get('filename') || '').trim();
      if (filename) {
        const content = await ctx.runQuery(internal.keywords.get, { filename });
        return jsonResponse(content);
      }
      const keywords = await ctx.runQuery(internal.keywords.list, {});
      return jsonResponse(keywords);
    }),
  });

  http.route({
    path: '/api/keywords',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const result = await ctx.runMutation(internal.keywords.upsert, {
        filename: body?.filename,
        content: body?.content,
      });
      return jsonResponse(result);
    }),
  });

  http.route({
    path: '/api/keywords/delete',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const result = await ctx.runMutation(internal.keywords.remove, {
        filename: body?.filename,
      });
      return jsonResponse(result);
    }),
  });
}
