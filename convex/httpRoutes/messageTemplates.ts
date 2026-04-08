import type { HttpRouter } from 'convex/server';
import { internal } from '../_generated/api';
import { jsonResponse, parseBody, registerPreflight, withErrorHandling } from './shared';

const messageTemplatePaths = ['/api/message-templates'];

export function registerMessageTemplateRoutes(http: HttpRouter): void {
  registerPreflight(http, messageTemplatePaths);

  http.route({
    path: '/api/message-templates',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const kind = url.searchParams.get('kind') || '';
      const texts = await ctx.runQuery(internal.messageTemplates.getInternal, { kind });
      return jsonResponse(texts);
    }),
  });

  http.route({
    path: '/api/message-templates',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const ok = await ctx.runMutation(internal.messageTemplates.upsertInternal, body as any);
      return jsonResponse({ ok });
    }),
  });
}
