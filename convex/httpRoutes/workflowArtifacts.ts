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
  '/api/workflow-artifacts/upsert',
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
        url.searchParams.get('workflowId') || '';
      if (!workflowId) throw new ValidationError('workflowId is required');
      const rows = await ctx.runQuery(internalApi.workflowArtifacts.listByWorkflowInternal, {
        workflowId: workflowId as any,
      });
      return jsonResponse(rows);
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
      const workflowId = body?.workflowId;
      if (!workflowId) throw new ValidationError('workflowId is required');
      const nodeId = body?.nodeId;
      if (!nodeId) throw new ValidationError('nodeId is required');
      const row = await ctx.runMutation(internalApi.workflowArtifacts.upsertInternal, {
        workflowId: workflowId as any,
        workflowName: body?.workflowName ?? '',
        nodeId: String(nodeId),
        nodeLabel: body?.nodeLabel,
        name: body?.name,
        kind: body?.kind,
        targets: body?.targets,
        targetUsername: body?.targetUsername,
        status: body?.status,
        imported: body?.imported,
        sourceProfileName: body?.sourceProfileName,
        lastRunAt: body?.lastRunAt,
        localArtifactPath: body?.localArtifactPath,
        localArtifactDeletedAt: body?.localArtifactDeletedAt,
        stats: body?.stats,
        metadata: body?.metadata,
      });
      return jsonResponse(row);
    }),
  });
}
