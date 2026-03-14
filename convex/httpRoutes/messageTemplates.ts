import type { HttpRouter } from 'convex/server';
import { api } from '../_generated/api';
import { httpAction } from '../_generated/server';
import { jsonResponse, parseBody, registerPreflight, requireAuth } from './shared';

const messageTemplatePaths = ['/api/message-templates'];

export function registerMessageTemplateRoutes(http: HttpRouter): void {
  registerPreflight(http, messageTemplatePaths);

  http.route({
    path: '/api/message-templates',
    method: 'GET',
    handler: httpAction(async (ctx, request) => {
      const authError = await requireAuth(request);
      if (authError) return authError;
      try {
        const url = new URL(request.url);
        const kind = url.searchParams.get('kind') || '';
        const texts = await ctx.runQuery(api.messageTemplates.get, { kind });
        return jsonResponse(texts);
      } catch (err: any) {
        return jsonResponse({ error: String(err?.message || err) }, 400);
      }
    }),
  });

  http.route({
    path: '/api/message-templates',
    method: 'POST',
    handler: httpAction(async (ctx, request) => {
      const authError = await requireAuth(request);
      if (authError) return authError;
      try {
        const body = await parseBody(request);
        const ok = await ctx.runMutation(api.messageTemplates.upsert, body as any);
        return jsonResponse({ ok });
      } catch (err: any) {
        return jsonResponse({ error: String(err?.message || err) }, 400);
      }
    }),
  });
}
