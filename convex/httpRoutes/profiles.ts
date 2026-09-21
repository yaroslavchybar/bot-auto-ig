import type { HttpRouter } from 'convex/server';
import { internal } from '../_generated/api';
import {
  jsonResponse,
  mapProfileToApi,
  parseBody,
  registerPreflight,
  withErrorHandling,
} from './shared';



const profilePaths = [
  '/api/profiles',
  '/api/profiles/by-name',
  '/api/profiles/by-id',
  '/api/profiles/update-by-name',
  '/api/profiles/delete-by-name',
  '/api/profiles/begin-delete',
  '/api/profiles/finish-delete',
  '/api/profiles/finish-rename',
  '/api/profiles/sync-status',
  '/api/profiles/rebuild-list-assignments',
];

export function registerProfileRoutes(http: HttpRouter): void {
  registerPreflight(http, profilePaths);
  registerProfileQueryRoutes(http);
  registerProfileCrudRoutes(http);
  registerProfileStatusRoutes(http);

}

/* ── Query routes ── */

function registerProfileQueryRoutes(http: HttpRouter): void {
  http.route({
    path: '/api/profiles',
    method: 'GET',
    handler: withErrorHandling(async (ctx) => {
      const profiles = await ctx.runQuery(internal.profiles.queries.listInternal, {});
      return jsonResponse(profiles.map(mapProfileToApi));
    }),
  });

  http.route({
    path: '/api/profiles/by-name',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const name = url.searchParams.get('name') || '';
      const profile = await ctx.runQuery(internal.profiles.queries.getByNameInternal, { name });
      return jsonResponse(mapProfileToApi(profile, { includeCookies: true }));
    }),
  });

  http.route({
    path: '/api/profiles/by-id',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const profileId =
        url.searchParams.get('profileId') || url.searchParams.get('id') || '';
      const profile = profileId
        ? await ctx.runQuery(internal.profiles.queries.getByIdInternal, { profileId: profileId as any })
        : null;
      return jsonResponse(mapProfileToApi(profile, { includeCookies: true }));
    }),
  });


}

/* ── CRUD routes ── */

function registerProfileCrudRoutes(http: HttpRouter): void {
  registerProfileCreateUpdateRoutes(http);
  registerProfileDeleteRoutes(http);
}

function registerProfileCreateUpdateRoutes(http: HttpRouter): void {
  http.route({
    path: '/api/profiles',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const created = await ctx.runMutation(internal.profiles.mutations.createInternal, {
        name: body?.name,
        proxy: body?.proxy ?? undefined,
        proxyType: body?.proxyType ?? undefined,
        fingerprintOs: body?.fingerprintOs ?? undefined,
        cookiesJson: body?.cookiesJson ?? undefined,
      });
      return jsonResponse(mapProfileToApi(created, { includeCookies: true }));
    }),
  });

  http.route({
    path: '/api/profiles/update-by-name',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const updated = await ctx.runMutation(internal.profiles.mutations.updateByNameInternal, {
        oldName: body?.oldName ?? body?.old_name,
        name: body?.name,
        proxy: body?.proxy ?? undefined,
        proxyType: body?.proxyType ?? undefined,
        fingerprintOs: body?.fingerprintOs ?? undefined,
        cookiesJson: body?.cookiesJson ?? undefined,
      } as any);
      return jsonResponse(mapProfileToApi(updated, { includeCookies: true }));
    }),
  });

}

function registerProfileDeleteRoutes(http: HttpRouter): void {
  http.route({
    path: '/api/profiles/begin-delete', method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const profile = await ctx.runMutation(internal.profiles.mutations.beginDeleteInternal, { name: body.name });
      return jsonResponse(mapProfileToApi(profile));
    }),
  });
  http.route({
    path: '/api/profiles/finish-delete', method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      await ctx.runMutation(internal.profiles.mutations.removeByIdInternal, { profileId: body.profileId });
      return jsonResponse({ ok: true });
    }),
  });
  http.route({
    path: '/api/profiles/finish-rename', method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      await ctx.runMutation(internal.profiles.mutations.finishRenameInternal, { profileId: body.profileId });
      return jsonResponse({ ok: true });
    }),
  });


  // Alias for /api/profiles/remove-by-name
  http.route({
    path: '/api/profiles/delete-by-name',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const ok = await ctx.runMutation(internal.profiles.mutations.removeByNameInternal, body as any);
      return jsonResponse({ ok });
    }),
  });
}

/* ── Status mutation routes ── */

function registerProfileStatusRoutes(http: HttpRouter): void {

  http.route({
    path: '/api/profiles/sync-status',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const ok = await ctx.runMutation(internal.profiles.mutations.syncStatusInternal, body as any);
      return jsonResponse({ ok });
    }),
  });

  http.route({
    path: '/api/profiles/rebuild-list-assignments',
    method: 'POST',
    handler: withErrorHandling(async (ctx) => {
      const ok = await ctx.runMutation(internal.profiles.mutations.rebuildListAssignmentsInternal, {});
      return jsonResponse({ ok });
    }),
  });
}

/* ── Assignment routes ── */

