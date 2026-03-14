import type { HttpRouter } from 'convex/server';
import { internal } from '../_generated/api';
import { httpAction } from '../_generated/server';
import { jsonResponse, parseBody, registerPreflight, requireAuth } from './shared';

const workflowPaths = [
  '/api/workflows',
  '/api/workflows/by-id',
  '/api/workflows/start',
  '/api/workflows/update-status',
];

export function registerWorkflowRoutes(http: HttpRouter): void {
  registerPreflight(http, workflowPaths);

  http.route({
    path: '/api/workflows',
    method: 'GET',
    handler: httpAction(async (ctx, request) => {
      const authError = await requireAuth(request);
      if (authError) return authError;
      try {
        const url = new URL(request.url);
        const status = url.searchParams.get('status') || undefined;
        const rows = await ctx.runQuery(internal.workflows.listInternal, {
          status: status as any,
        });
        return jsonResponse(rows);
      } catch (err: any) {
        return jsonResponse({ error: String(err?.message || err) }, 400);
      }
    }),
  });

  http.route({
    path: '/api/workflows/by-id',
    method: 'GET',
    handler: httpAction(async (ctx, request) => {
      const authError = await requireAuth(request);
      if (authError) return authError;
      try {
        const url = new URL(request.url);
        const workflowId =
          url.searchParams.get('workflowId') || url.searchParams.get('id') || '';
        if (!workflowId) return jsonResponse({ error: 'workflowId is required' }, 400);
        const row = await ctx.runQuery(internal.workflows.getInternal, {
          id: workflowId as any,
        });
        return jsonResponse(row);
      } catch (err: any) {
        return jsonResponse({ error: String(err?.message || err) }, 400);
      }
    }),
  });

  http.route({
    path: '/api/workflows/start',
    method: 'POST',
    handler: httpAction(async (ctx, request) => {
      const authError = await requireAuth(request);
      if (authError) return authError;
      try {
        const body = await parseBody(request);
        const id = body?.id ?? body?.workflowId ?? body?.workflow_id;
        if (!id) return jsonResponse({ error: 'id is required' }, 400);
        const row = await ctx.runMutation(internal.workflows.startInternal, {
          id: id as any,
        });
        return jsonResponse(row);
      } catch (err: any) {
        return jsonResponse({ error: String(err?.message || err) }, 400);
      }
    }),
  });

  http.route({
    path: '/api/workflows/update-status',
    method: 'POST',
    handler: httpAction(async (ctx, request) => {
      const authError = await requireAuth(request);
      if (authError) return authError;
      try {
        const body = await parseBody(request);
        const id = body?.id ?? body?.workflowId ?? body?.workflow_id;
        if (!id) return jsonResponse({ error: 'id is required' }, 400);
        const row = await ctx.runMutation(internal.workflows.updateStatusInternal, {
          id: id as any,
          status: body?.status,
          currentNodeId: body?.currentNodeId ?? body?.current_node_id,
          nodeStates: body?.nodeStates ?? body?.node_states,
          error: body?.error,
        });
        return jsonResponse(row);
      } catch (err: any) {
        return jsonResponse({ error: String(err?.message || err) }, 400);
      }
    }),
  });
}
