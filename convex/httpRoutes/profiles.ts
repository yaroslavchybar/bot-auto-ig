import type { HttpRouter } from 'convex/server';
import { internal } from '../_generated/api';
import {
  jsonResponse,
  mapProfileToPython,
  parseBody,
  registerPreflight,
  withErrorHandling,
  ValidationError,
} from './shared';

const internalApi = internal as any;

const profilePaths = [
  '/api/profiles',
  '/api/profiles/by-name',
  '/api/profiles/by-id',
  '/api/profiles/available',
  '/api/profiles/by-list-ids',
  '/api/profiles/update-by-name',
  '/api/profiles/update-by-id',
  '/api/profiles/delete-by-id',
  '/api/profiles/remove-by-name',
  '/api/profiles/delete-by-name',
  '/api/profiles/clear-busy-for-lists',
  '/api/profiles/sync-status',
  '/api/profiles/set-login-true',
  '/api/profiles/increment-daily-scraping-used',
  '/api/profiles/claim-scrape-lease',
  '/api/profiles/refresh-scrape-lease',
  '/api/profiles/release-scrape-lease',
  '/api/profiles/mark-scrape-success',
  '/api/profiles/mark-scrape-failure',
  '/api/profiles/sweep-expired-scrape-leases',
  '/api/profiles/assigned',
  '/api/profiles/unassigned',
  '/api/profiles/bulk-set-list-id',
  '/api/profiles/bulk-add-to-list',
  '/api/profiles/bulk-remove-from-list',
];

export function registerProfileRoutes(http: HttpRouter): void {
  registerPreflight(http, profilePaths);
  registerProfileQueryRoutes(http);
  registerProfileCrudRoutes(http);
  registerProfileStatusRoutes(http);
  registerProfileScrapingRoutes(http);
  registerProfileAssignmentRoutes(http);
  registerProfileBulkRoutes(http);
}

/* ── Query routes ── */

function registerProfileQueryRoutes(http: HttpRouter): void {
  http.route({
    path: '/api/profiles',
    method: 'GET',
    handler: withErrorHandling(async (ctx) => {
      const profiles = await ctx.runQuery(internal.profiles.queries.listInternal, {});
      return jsonResponse(profiles.map(mapProfileToPython));
    }),
  });

  http.route({
    path: '/api/profiles/by-name',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const name = url.searchParams.get('name') || '';
      const profile = await ctx.runQuery(internalApi.profiles.queries.getByNameInternal, { name });
      return jsonResponse(mapProfileToPython(profile, { includeCookies: true }));
    }),
  });

  http.route({
    path: '/api/profiles/by-id',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const profileId =
        url.searchParams.get('profileId') || url.searchParams.get('profile_id') || '';
      const profile = profileId
        ? await ctx.runQuery(internal.profiles.queries.getByIdInternal, { profileId: profileId as any })
        : null;
      return jsonResponse(mapProfileToPython(profile, { includeCookies: true }));
    }),
  });

  http.route({
    path: '/api/profiles/available',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const listIds = (body?.listIds ?? body?.list_ids ?? []) as any[];
      const cooldownMinutes = body?.cooldownMinutes ?? body?.cooldown_minutes ?? 0;
      const profiles = await ctx.runQuery(internalApi.profiles.queries.getAvailableForListsInternal, {
        listIds,
        cooldownMinutes,
      });
      return jsonResponse(profiles.map(mapProfileToPython));
    }),
  });

  http.route({
    path: '/api/profiles/by-list-ids',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const listIds = (body?.listIds ?? body?.list_ids ?? []) as any[];
      const profiles = await ctx.runQuery(internalApi.profiles.queries.getByListIdsInternal, {
        listIds,
      });
      return jsonResponse(profiles.map(mapProfileToPython));
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
      const created = await ctx.runMutation(internalApi.profiles.mutations.createInternal, {
        name: body?.name,
        proxy: body?.proxy ?? undefined,
        proxyType: body?.proxyType ?? body?.proxy_type ?? undefined,
        fingerprintSeed: body?.fingerprintSeed ?? body?.fingerprint_seed ?? undefined,
        fingerprintOs: body?.fingerprintOs ?? body?.fingerprint_os ?? undefined,
        cookiesJson: body?.cookiesJson ?? body?.cookies_json ?? undefined,
        testIp: body?.testIp ?? body?.test_ip ?? undefined,
        sessionId: body?.sessionId ?? body?.session_id ?? undefined,
        dailyScrapingLimit:
          body?.dailyScrapingLimit ?? body?.daily_scraping_limit ?? undefined,
      });
      return jsonResponse(mapProfileToPython(created, { includeCookies: true }));
    }),
  });

  http.route({
    path: '/api/profiles/update-by-name',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const updated = await ctx.runMutation(internalApi.profiles.mutations.updateByNameInternal, {
        oldName: body?.oldName ?? body?.old_name,
        name: body?.name,
        proxy: body?.proxy ?? undefined,
        proxyType: body?.proxyType ?? body?.proxy_type ?? undefined,
        fingerprintSeed: body?.fingerprintSeed ?? body?.fingerprint_seed ?? undefined,
        fingerprintOs: body?.fingerprintOs ?? body?.fingerprint_os ?? undefined,
        cookiesJson: body?.cookiesJson ?? body?.cookies_json ?? undefined,
        testIp: body?.testIp ?? body?.test_ip ?? undefined,
        sessionId: body?.sessionId ?? body?.session_id ?? undefined,
        dailyScrapingLimit:
          body?.dailyScrapingLimit ?? body?.daily_scraping_limit ?? undefined,
      } as any);
      return jsonResponse(mapProfileToPython(updated, { includeCookies: true }));
    }),
  });

  http.route({
    path: '/api/profiles/update-by-id',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const updated = await ctx.runMutation(internalApi.profiles.mutations.updateByIdInternal, {
        profileId: (body?.profileId ?? body?.profile_id) as any,
        name: body?.name,
        proxy: body?.proxy ?? undefined,
        proxyType: body?.proxyType ?? body?.proxy_type ?? undefined,
        fingerprintSeed: body?.fingerprintSeed ?? body?.fingerprint_seed ?? undefined,
        fingerprintOs: body?.fingerprintOs ?? body?.fingerprint_os ?? undefined,
        cookiesJson: body?.cookiesJson ?? body?.cookies_json ?? undefined,
        testIp: body?.testIp ?? body?.test_ip ?? undefined,
        sessionId: body?.sessionId ?? body?.session_id ?? undefined,
        dailyScrapingLimit:
          body?.dailyScrapingLimit ?? body?.daily_scraping_limit ?? undefined,
      });
      return jsonResponse(mapProfileToPython(updated, { includeCookies: true }));
    }),
  });
}

function registerProfileDeleteRoutes(http: HttpRouter): void {
  http.route({
    path: '/api/profiles/delete-by-id',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const ok = await ctx.runMutation(internalApi.profiles.mutations.removeByIdInternal, {
        profileId: (body?.profileId ?? body?.profile_id) as any,
      });
      return jsonResponse({ ok });
    }),
  });

  http.route({
    path: '/api/profiles/remove-by-name',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const ok = await ctx.runMutation(internalApi.profiles.mutations.removeByNameInternal, body as any);
      return jsonResponse({ ok });
    }),
  });

  // Alias for /api/profiles/remove-by-name
  http.route({
    path: '/api/profiles/delete-by-name',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const ok = await ctx.runMutation(internalApi.profiles.mutations.removeByNameInternal, body as any);
      return jsonResponse({ ok });
    }),
  });
}

/* ── Status mutation routes ── */

function registerProfileStatusRoutes(http: HttpRouter): void {
  http.route({
    path: '/api/profiles/clear-busy-for-lists',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const listIds = body?.listIds ?? body?.list_ids ?? [];
      const ok = await ctx.runMutation(internalApi.profiles.mutations.clearBusyForListsInternal, {
        listIds: listIds as any[],
      });
      return jsonResponse({ ok });
    }),
  });

  http.route({
    path: '/api/profiles/sync-status',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const ok = await ctx.runMutation(internalApi.profiles.mutations.syncStatusInternal, body as any);
      return jsonResponse({ ok });
    }),
  });

  http.route({
    path: '/api/profiles/set-login-true',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const ok = await ctx.runMutation(internalApi.profiles.mutations.setLoginTrueInternal, body as any);
      return jsonResponse({ ok });
    }),
  });

  http.route({
    path: '/api/profiles/increment-daily-scraping-used',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const ok = await ctx.runMutation(
        internal.profiles.mutations.incrementDailyScrapingUsedInternal,
        body as any,
      );
      return jsonResponse({ ok });
    }),
  });
}

/* ── Scraping lease routes ── */

function registerProfileScrapingRoutes(http: HttpRouter): void {
  registerScrapeLeaseRoutes(http);
  registerScrapeResultRoutes(http);
}

function registerScrapeLeaseRoutes(http: HttpRouter): void {
  http.route({
    path: '/api/profiles/claim-scrape-lease',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const profile = await ctx.runMutation(internal.profiles.scraping.claimBestScrapeLeaseInternal, {
        workerId: body?.workerId,
        leaseMs: body?.leaseMs,
        now: body?.now ?? Date.now(),
        minHealth: body?.minHealth,
      });
      return jsonResponse(mapProfileToPython(profile));
    }),
  });

  http.route({
    path: '/api/profiles/refresh-scrape-lease',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const profile = await ctx.runMutation(internal.profiles.scraping.refreshScrapeLeaseInternal, {
        profileId: body?.profileId,
        workerId: body?.workerId,
        leaseMs: body?.leaseMs,
        now: body?.now ?? Date.now(),
      });
      return jsonResponse(mapProfileToPython(profile));
    }),
  });

  http.route({
    path: '/api/profiles/release-scrape-lease',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const ok = await ctx.runMutation(internal.profiles.scraping.releaseScrapeLeaseInternal, {
        profileId: body?.profileId,
        workerId: body?.workerId,
      });
      return jsonResponse({ ok });
    }),
  });
}

function registerScrapeResultRoutes(http: HttpRouter): void {
  http.route({
    path: '/api/profiles/mark-scrape-success',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const profile = await ctx.runMutation(internal.profiles.scraping.markScrapeSuccessInternal, {
        profileId: body?.profileId,
        workerId: body?.workerId,
        amount: body?.amount,
        now: body?.now ?? Date.now(),
      });
      return jsonResponse(mapProfileToPython(profile));
    }),
  });

  http.route({
    path: '/api/profiles/mark-scrape-failure',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const profile = await ctx.runMutation(internal.profiles.scraping.markScrapeFailureInternal, {
        profileId: body?.profileId,
        workerId: body?.workerId,
        now: body?.now ?? Date.now(),
      });
      return jsonResponse(mapProfileToPython(profile));
    }),
  });

  http.route({
    path: '/api/profiles/sweep-expired-scrape-leases',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const result = await ctx.runMutation(
        internal.profiles.scraping.sweepExpiredScrapeLeasesInternal,
        { now: body?.now ?? Date.now() },
      );
      return jsonResponse(result);
    }),
  });
}

/* ── Assignment routes ── */

function registerProfileAssignmentRoutes(http: HttpRouter): void {
  http.route({
    path: '/api/profiles/assigned',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const listId = url.searchParams.get('list_id');
      if (!listId) throw new ValidationError('list_id is required');
      const profiles = await ctx.runQuery(internalApi.profiles.queries.listAssignedInternal, {
        listId: listId as any,
      });
      return jsonResponse(
        profiles.map((p: any) => ({ profile_id: p.profileId, name: p.name })),
      );
    }),
  });

  http.route({
    path: '/api/profiles/unassigned',
    method: 'GET',
    handler: withErrorHandling(async (ctx) => {
      const profiles = await ctx.runQuery(internalApi.profiles.queries.listUnassignedInternal, {});
      return jsonResponse(
        profiles.map((p: any) => ({ profile_id: p.profileId, name: p.name })),
      );
    }),
  });
}

/* ── Bulk routes ── */

function registerProfileBulkRoutes(http: HttpRouter): void {
  http.route({
    path: '/api/profiles/bulk-set-list-id',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const profileIds = body?.profileIds ?? body?.profile_ids ?? [];
      const listId = body?.listId ?? body?.list_id;
      const ok = await ctx.runMutation(internalApi.profiles.mutations.bulkSetListIdInternal, {
        profileIds: profileIds as any[],
        listId: listId === null ? null : (listId as any),
      });
      return jsonResponse({ ok });
    }),
  });

  http.route({
    path: '/api/profiles/bulk-add-to-list',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const profileIds = body?.profileIds ?? body?.profile_ids ?? [];
      const listId = body?.listId ?? body?.list_id;
      const ok = await ctx.runMutation(internalApi.profiles.mutations.bulkAddToListInternal, {
        profileIds: profileIds as any[],
        listId: listId as any,
      });
      return jsonResponse({ ok });
    }),
  });

  http.route({
    path: '/api/profiles/bulk-remove-from-list',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const profileIds = body?.profileIds ?? body?.profile_ids ?? [];
      const listId = body?.listId ?? body?.list_id;
      const ok = await ctx.runMutation(internalApi.profiles.mutations.bulkRemoveFromListInternal, {
        profileIds: profileIds as any[],
        listId: listId as any,
      });
      return jsonResponse({ ok });
    }),
  });
}
