import type { HttpRouter } from 'convex/server';
import { api } from '../_generated/api';
import {
  jsonResponse,
  mapListToApi,
  registerPreflight,
  withErrorHandling,
} from './shared';

const listPaths = ['/api/lists'];

export function registerListRoutes(http: HttpRouter): void {
  registerPreflight(http, listPaths);

  http.route({
    path: '/api/lists',
    method: 'GET',
    handler: withErrorHandling(async (ctx) => {
      const lists = await ctx.runQuery(api.lists.list, {});
      return jsonResponse(lists.map(mapListToApi));
    }),
  });

}
