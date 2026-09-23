import type { HttpRouter } from 'convex/server';
import type { Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { jsonResponse, parseBody, registerPreflight, withErrorHandling } from './shared';

export function registerLeadListRoutes(http: HttpRouter): void {
  registerPreflight(http, ['/api/lead-lists/rename', '/api/lead-lists/delete']);
  http.route({ path: '/api/lead-lists/rename', method: 'POST', handler: withErrorHandling(async (ctx, request) => {
    const body = await parseBody(request);
    await ctx.runMutation(internal.leads.renameList, {
      listId: body.listId as Id<'leadLists'>, name: body.name,
    });
    return jsonResponse({ ok: true });
  }) });
  http.route({ path: '/api/lead-lists/delete', method: 'POST', handler: withErrorHandling(async (ctx, request) => {
    const body = await parseBody(request);
    await ctx.runMutation(internal.leads.deleteList, { listId: body.listId as Id<'leadLists'> });
    return jsonResponse({ ok: true });
  }) });
}
