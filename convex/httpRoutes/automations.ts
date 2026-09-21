import type { HttpRouter } from 'convex/server';
import { internal } from '../_generated/api';
import {
  jsonResponse,
  parseBody,
  registerPreflight,
  withErrorHandling,
  ValidationError,
} from './shared';

const automationPaths = [
  '/api/automations',
  '/api/automations/reconcile',
  '/api/automations/by-id',
  '/api/automations/start',
  '/api/automations/update-status',
  '/api/automations/runtime-page',
];

export function registerAutomationRoutes(http: HttpRouter): void {
  registerPreflight(http, automationPaths);
  http.route({
    path: '/api/automations/reconcile', method: 'POST',
    handler: withErrorHandling(async ctx => jsonResponse(await ctx.runMutation(internal.automations.mutations.reconcileInterruptedInternal, {}))),
  });

  http.route({
    path: '/api/automations',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const status = url.searchParams.get('status') || undefined;
      const rows = await ctx.runQuery(internal.automations.queries.listInternal, {
        status: status as any,
      });
      return jsonResponse(rows);
    }),
  });

  http.route({
    path: '/api/automations/by-id',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const automationId =
        url.searchParams.get('automationId') || '';
      if (!automationId) throw new ValidationError('automationId is required');
      const row = await ctx.runQuery(internal.automations.queries.getInternal, {
        id: automationId as any,
      });
      return jsonResponse(row);
    }),
  });

  http.route({
    path: '/api/automations/start',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const id = body?.id;
      if (!id) throw new ValidationError('id is required');
      const row = await ctx.runMutation(internal.automations.mutations.startInternal, {
        id: id as any,
      });
      return jsonResponse(row);
    }),
  });

  http.route({
    path: '/api/automations/update-status',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const id = body?.id;
      if (!id) throw new ValidationError('id is required');
      const row = await ctx.runMutation(internal.automations.mutations.updateStatusInternal, {
        id: id as any,
        status: body?.status,
        currentNodeId: body?.currentNodeId,
        nodeStates: body?.nodeStates,
        error: body?.error,
      });
      return jsonResponse(row);
    }),
  });

  http.route({
    path: '/api/automations/runtime-page',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const automationId = url.searchParams.get('automationId') || '';
      if (!automationId) throw new ValidationError('automationId is required');
      const listId = url.searchParams.get('listId') || '';
      if (!listId) throw new ValidationError('listId is required');
      const cursor = url.searchParams.get('cursor') || undefined;
      const page = await ctx.runQuery(internal.automations.queries.runtimeListPageInternal, {
        id: automationId as any,
        listId,
        cursor,
      });
      return jsonResponse(page);
    }),
  });
}
