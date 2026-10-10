import type { HttpRouter } from 'convex/server';
import { api, internal } from '../_generated/api';
import {
  jsonResponse,
  mapListToApi,
  parseBody,
  registerPreflight,
  ValidationError,
  withErrorHandling,
} from './shared';

const listPaths = ['/api/lists', '/api/lists/content-cleanup'];

export function registerListRoutes(http: HttpRouter): void {
  registerPreflight(http, listPaths);
  http.route({
    path: '/api/lists/content-cleanup',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      if (body.operation === 'queue')
        await ctx.runMutation(internal.lists.queueContentCleanupInternal, { modelId: body.modelId });
      else if (body.operation === 'finish')
        await ctx.runMutation(internal.lists.finishContentCleanupInternal, { modelId: body.modelId });
      else throw new ValidationError('Unknown content cleanup operation');
      return jsonResponse({ ok: true });
    }),
  });

  http.route({
    path: '/api/lists',
    method: 'GET',
    handler: withErrorHandling(async (ctx) => {
      const lists = await ctx.runQuery(api.lists.list, {});
      return jsonResponse(lists.map(mapListToApi));
    }),
  });

}
