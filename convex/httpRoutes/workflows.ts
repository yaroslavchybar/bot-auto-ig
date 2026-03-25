import type { HttpRouter } from 'convex/server';
import { internal } from '../_generated/api';
import {
  jsonResponse,
  parseBody,
  registerPreflight,
  withErrorHandling,
  ValidationError,
} from './shared';

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
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const status = url.searchParams.get('status') || undefined;
      const rows = await ctx.runQuery(internal.workflows.queries.listInternal, {
        status: status as any,
      });
      return jsonResponse(rows);
    }),
  });

  http.route({
    path: '/api/workflows/by-id',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const workflowId =
        url.searchParams.get('workflowId') || url.searchParams.get('id') || '';
      if (!workflowId) throw new ValidationError('workflowId is required');
      const row = await ctx.runQuery(internal.workflows.queries.getInternal, {
        id: workflowId as any,
      });
      return jsonResponse(row);
    }),
  });

  http.route({
    path: '/api/workflows/start',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const id = body?.id ?? body?.workflowId ?? body?.workflow_id;
      if (!id) throw new ValidationError('id is required');
      const row = await ctx.runMutation(internal.workflows.mutations.startInternal, {
        id: id as any,
      });
      return jsonResponse(row);
    }),
  });

  http.route({
    path: '/api/workflows/update-status',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const id = body?.id ?? body?.workflowId ?? body?.workflow_id;
      if (!id) throw new ValidationError('id is required');
      const row = await ctx.runMutation(internal.workflows.mutations.updateStatusInternal, {
        id: id as any,
        status: body?.status,
        currentNodeId: body?.currentNodeId ?? body?.current_node_id,
        nodeStates: body?.nodeStates ?? body?.node_states,
        error: body?.error,
      });
      return jsonResponse(row);
    }),
  });
}
