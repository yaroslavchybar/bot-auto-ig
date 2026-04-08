import type { HttpRouter } from 'convex/server';
import { internal } from '../_generated/api';
import {
  jsonResponse,
  parseBody,
  registerPreflight,
  withErrorHandling,
  ValidationError,
} from './shared';

const internalApi = internal as any;

const workflowArtifactPaths = [
  '/api/workflow-artifacts',
  '/api/workflow-artifacts/by-id',
  '/api/workflow-artifacts/unimported',
  '/api/workflow-artifacts/upsert',
  '/api/workflow-artifacts/set-imported',
  '/api/workflow-artifacts/set-local-artifact-deleted',
  '/api/workflow-artifacts/finalize-local-import',
  '/api/workflow-artifacts/store-artifact',
  '/api/workflow-artifacts/storage-url',
];

export function registerWorkflowArtifactRoutes(http: HttpRouter): void {
  registerPreflight(http, workflowArtifactPaths);
  registerArtifactQueryRoutes(http);
  registerArtifactMutationRoutes(http);
}

/* ── Query routes ── */

function registerArtifactQueryRoutes(http: HttpRouter): void {
  http.route({
    path: '/api/workflow-artifacts',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const workflowId =
        url.searchParams.get('workflowId') || url.searchParams.get('id') || '';
      if (!workflowId) throw new ValidationError('workflowId is required');
      const rows = await ctx.runQuery(internalApi.workflowArtifacts.listByWorkflowInternal, {
        workflowId: workflowId as any,
      });
      return jsonResponse(rows);
    }),
  });

  http.route({
    path: '/api/workflow-artifacts/by-id',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const id = url.searchParams.get('id') || '';
      if (!id) throw new ValidationError('id is required');
      const row = await ctx.runQuery(internalApi.workflowArtifacts.getByIdInternal, {
        id: id as any,
      });
      return jsonResponse(row);
    }),
  });

  http.route({
    path: '/api/workflow-artifacts/unimported',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const kind = url.searchParams.get('kind') || undefined;
      const rows = await ctx.runQuery(internalApi.workflowArtifacts.listUnimportedInternal, {
        kind,
      });
      return jsonResponse(rows);
    }),
  });

  http.route({
    path: '/api/workflow-artifacts/storage-url',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const storageId = url.searchParams.get('storageId') || '';
      if (!storageId) throw new ValidationError('storageId is required');
      const result = await ctx.runQuery(internalApi.workflowArtifacts.getStorageUrlInternal, {
        storageId: storageId as any,
      });
      return jsonResponse(result);
    }),
  });
}

/* ── Mutation routes ── */

function registerArtifactMutationRoutes(http: HttpRouter): void {
  http.route({
    path: '/api/workflow-artifacts/upsert',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const workflowId = body?.workflowId ?? body?.workflow_id;
      if (!workflowId) throw new ValidationError('workflowId is required');
      const nodeId = body?.nodeId ?? body?.node_id;
      if (!nodeId) throw new ValidationError('nodeId is required');
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
        imported: body?.imported,
        sourceProfileName: body?.sourceProfileName ?? body?.source_profile_name,
        lastRunAt: body?.lastRunAt ?? body?.last_run_at,
        storageId: body?.storageId ?? body?.storage_id,
        manifestStorageId: body?.manifestStorageId ?? body?.manifest_storage_id,
        exportStorageId: body?.exportStorageId ?? body?.export_storage_id,
        localArtifactPath: body?.localArtifactPath ?? body?.local_artifact_path,
        localArtifactDeletedAt: body?.localArtifactDeletedAt ?? body?.local_artifact_deleted_at,
        stats: body?.stats,
        metadata: body?.metadata,
      });
      return jsonResponse(row);
    }),
  });

  http.route({
    path: '/api/workflow-artifacts/set-imported',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const id = body?.id;
      if (!id) throw new ValidationError('id is required');
      const row = await ctx.runMutation(internalApi.workflowArtifacts.setImportedInternal, {
        id: id as any,
        imported: Boolean(body?.imported),
      });
      return jsonResponse(row);
    }),
  });

  http.route({
    path: '/api/workflow-artifacts/set-local-artifact-deleted',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const id = body?.id;
      if (!id) throw new ValidationError('id is required');
      const deletedAt = Number(body?.deletedAt ?? body?.deleted_at ?? Date.now());
      const row = await ctx.runMutation(internalApi.workflowArtifacts.setLocalArtifactDeletedInternal, {
        id: id as any,
        deletedAt,
      });
      return jsonResponse(row);
    }),
  });

  http.route({
    path: '/api/workflow-artifacts/finalize-local-import',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const id = body?.id;
      if (!id) throw new ValidationError('id is required');
      const deletedAt = Number(body?.deletedAt ?? body?.deleted_at ?? Date.now());
      const row = await ctx.runMutation(internalApi.workflowArtifacts.finalizeLocalImportInternal, {
        id: id as any,
        imported: Boolean(body?.imported ?? true),
        deletedAt,
      });
      return jsonResponse(row);
    }),
  });

  http.route({
    path: '/api/workflow-artifacts/store-artifact',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const result = await ctx.runAction(
        internalApi.workflowArtifacts.storeArtifactInternal,
        { payload: body?.payload },
      );
      return jsonResponse(result);
    }),
  });
}
