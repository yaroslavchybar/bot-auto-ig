import type { HttpRouter } from 'convex/server';
import { internal } from '../_generated/api';
import { httpAction } from '../_generated/server';
import { jsonResponse, parseBody, registerPreflight, requireAuth } from './shared';

const internalApi = internal as any;

const workflowArtifactPaths = [
  '/api/workflow-artifacts',
  '/api/workflow-artifacts/by-id',
  '/api/workflow-artifacts/unimported',
  '/api/workflow-artifacts/upsert',
  '/api/workflow-artifacts/set-imported',
  '/api/workflow-artifacts/store-artifact',
  '/api/workflow-artifacts/storage-url',
];

export function registerWorkflowArtifactRoutes(http: HttpRouter): void {
  registerPreflight(http, workflowArtifactPaths);

  http.route({
    path: '/api/workflow-artifacts',
    method: 'GET',
    handler: httpAction(async (ctx, request) => {
      const authError = await requireAuth(request);
      if (authError) return authError;
      try {
        const url = new URL(request.url);
        const workflowId =
          url.searchParams.get('workflowId') || url.searchParams.get('id') || '';
        if (!workflowId) return jsonResponse({ error: 'workflowId is required' }, 400);
        const rows = await ctx.runQuery(internalApi.workflowArtifacts.listByWorkflowInternal, {
          workflowId: workflowId as any,
        });
        return jsonResponse(rows);
      } catch (err: any) {
        return jsonResponse({ error: String(err?.message || err) }, 400);
      }
    }),
  });

  http.route({
    path: '/api/workflow-artifacts/by-id',
    method: 'GET',
    handler: httpAction(async (ctx, request) => {
      const authError = await requireAuth(request);
      if (authError) return authError;
      try {
        const url = new URL(request.url);
        const id = url.searchParams.get('id') || '';
        if (!id) return jsonResponse({ error: 'id is required' }, 400);
        const row = await ctx.runQuery(internalApi.workflowArtifacts.getByIdInternal, {
          id: id as any,
        });
        return jsonResponse(row);
      } catch (err: any) {
        return jsonResponse({ error: String(err?.message || err) }, 400);
      }
    }),
  });

  http.route({
    path: '/api/workflow-artifacts/unimported',
    method: 'GET',
    handler: httpAction(async (ctx, request) => {
      const authError = await requireAuth(request);
      if (authError) return authError;
      try {
        const url = new URL(request.url);
        const kind = url.searchParams.get('kind') || undefined;
        const rows = await ctx.runQuery(internalApi.workflowArtifacts.listUnimportedInternal, {
          kind,
        });
        return jsonResponse(rows);
      } catch (err: any) {
        return jsonResponse({ error: String(err?.message || err) }, 400);
      }
    }),
  });

  http.route({
    path: '/api/workflow-artifacts/upsert',
    method: 'POST',
    handler: httpAction(async (ctx, request) => {
      const authError = await requireAuth(request);
      if (authError) return authError;
      try {
        const body = await parseBody(request);
        const workflowId = body?.workflowId ?? body?.workflow_id;
        if (!workflowId) return jsonResponse({ error: 'workflowId is required' }, 400);
        const nodeId = body?.nodeId ?? body?.node_id;
        if (!nodeId) return jsonResponse({ error: 'nodeId is required' }, 400);
        const row = await ctx.runMutation(internalApi.workflowArtifacts.upsertInternal, {
          workflowId: workflowId as any,
          workflowName: body?.workflowName ?? body?.workflow_name ?? '',
          nodeId: String(nodeId),
          nodeLabel: body?.nodeLabel ?? body?.node_label,
          name: body?.name,
          kind: body?.kind,
          targets: body?.targets,
          targetUsername: body?.targetUsername ?? body?.target_username,
          status: body?.status,
          sourceProfileName: body?.sourceProfileName ?? body?.source_profile_name,
          lastRunAt: body?.lastRunAt ?? body?.last_run_at,
          storageId: body?.storageId ?? body?.storage_id,
          manifestStorageId: body?.manifestStorageId ?? body?.manifest_storage_id,
          exportStorageId: body?.exportStorageId ?? body?.export_storage_id,
          stats: body?.stats,
          metadata: body?.metadata,
        });
        return jsonResponse(row);
      } catch (err: any) {
        return jsonResponse({ error: String(err?.message || err) }, 400);
      }
    }),
  });

  http.route({
    path: '/api/workflow-artifacts/set-imported',
    method: 'POST',
    handler: httpAction(async (ctx, request) => {
      const authError = await requireAuth(request);
      if (authError) return authError;
      try {
        const body = await parseBody(request);
        const id = body?.id;
        if (!id) return jsonResponse({ error: 'id is required' }, 400);
        const row = await ctx.runMutation(internalApi.workflowArtifacts.setImportedInternal, {
          id: id as any,
          imported: Boolean(body?.imported),
        });
        return jsonResponse(row);
      } catch (err: any) {
        return jsonResponse({ error: String(err?.message || err) }, 400);
      }
    }),
  });

  http.route({
    path: '/api/workflow-artifacts/store-artifact',
    method: 'POST',
    handler: httpAction(async (ctx, request) => {
      const authError = await requireAuth(request);
      if (authError) return authError;
      try {
        const body = await parseBody(request);
        const result = await ctx.runAction(
          internalApi.workflowArtifacts.storeArtifactInternal,
          { payload: body?.payload },
        );
        return jsonResponse(result);
      } catch (err: any) {
        return jsonResponse({ error: String(err?.message || err) }, 400);
      }
    }),
  });

  http.route({
    path: '/api/workflow-artifacts/storage-url',
    method: 'GET',
    handler: httpAction(async (ctx, request) => {
      const authError = await requireAuth(request);
      if (authError) return authError;
      try {
        const url = new URL(request.url);
        const storageId = url.searchParams.get('storageId') || '';
        if (!storageId) return jsonResponse({ error: 'storageId is required' }, 400);
        const result = await ctx.runQuery(internalApi.workflowArtifacts.getStorageUrlInternal, {
          storageId: storageId as any,
        });
        return jsonResponse(result);
      } catch (err: any) {
        return jsonResponse({ error: String(err?.message || err) }, 400);
      }
    }),
  });
}
