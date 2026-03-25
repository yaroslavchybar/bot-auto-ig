import type { HttpRouter } from 'convex/server';
import { api } from '../_generated/api';
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
      const texts = await ctx.runQuery(api.messageTemplates.get, { kind });
      return jsonResponse(texts);
    }),
  });

  http.route({
    path: '/api/message-templates',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const ok = await ctx.runMutation(api.messageTemplates.upsert, body as any);
      return jsonResponse({ ok });
    }),
  });
}
