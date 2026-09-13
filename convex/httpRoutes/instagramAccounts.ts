import type { HttpRouter } from 'convex/server';
import { internal } from '../_generated/api';
import {
  jsonResponse,
  mapAccountToApi,
  mapProfileToApi,
  parseBody,
  registerPreflight,
  withErrorHandling,
  ValidationError,
} from './shared';

const instagramAccountPaths = [
  '/api/instagram-accounts',
  '/api/instagram-accounts/insert-many',
  '/api/instagram-accounts/for-profile',
  '/api/instagram-accounts/by-status',
  '/api/instagram-accounts/by-job',
  '/api/instagram-accounts/to-message',
  '/api/instagram-accounts/update-status',
  '/api/instagram-accounts/update-message',
  '/api/instagram-accounts/usernames',
  '/api/instagram-accounts/profiles-with-assigned',
];

export function registerInstagramAccountRoutes(http: HttpRouter): void {
  registerPreflight(http, instagramAccountPaths);
  registerAccountMutationRoutes(http);
  registerAccountQueryRoutes(http);
}

/* ── Mutation routes ── */

function registerAccountMutationRoutes(http: HttpRouter): void {
  http.route({
    path: '/api/instagram-accounts',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const created = await ctx.runMutation(internal.instagramAccounts.insert, {
        userName: body?.userName ?? body?.user_name,
        fullName: body?.fullName ?? body?.full_name,
        matchedName: body?.matchedName ?? body?.matched_name,
        status: body?.status,
        message: body?.message,
        createdAt: body?.createdAt ?? body?.created_at,
        isVerified: body?.isVerified ?? body?.is_verified,
        isPrivate: body?.isPrivate ?? body?.is_private,
        sourceJobId: body?.sourceJobId ?? body?.source_job_id,
      });
      return jsonResponse(created);
    }),
  });

  http.route({
    path: '/api/instagram-accounts/insert-many',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const accounts = Array.isArray(body?.accounts) ? body.accounts : [];
      const created = await ctx.runMutation(internal.instagramAccounts.insertMany, {
        accounts: accounts.map((account: any) => ({
          userName: account?.userName ?? account?.user_name ?? '',
          fullName: account?.fullName ?? account?.full_name,
          isVerified: account?.isVerified ?? account?.is_verified,
          isPrivate: account?.isPrivate ?? account?.is_private,
          sourceJobId: account?.sourceJobId ?? account?.source_job_id,
        })),
      });
      return jsonResponse(created);
    }),
  });

  http.route({
    path: '/api/instagram-accounts/update-status',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const updated = await ctx.runMutation(internal.instagramAccounts.updateStatus, {
        accountId: (body?.accountId ?? body?.account_id ?? body?.id) as any,
        status: body?.status,
        assignedTo:
          typeof body?.assigned_to !== 'undefined' ? body.assigned_to : body?.assignedTo,
      });
      return jsonResponse(mapAccountToApi(updated));
    }),
  });

  http.route({
    path: '/api/instagram-accounts/update-message',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const body = await parseBody(request);
      const updated = await ctx.runMutation(internal.instagramAccounts.updateMessage, {
        userName: body?.userName ?? body?.user_name,
        message: body?.message,
        lastMessagedAt: body?.lastMessagedAt ?? body?.last_messaged_at,
      });
      return jsonResponse(mapAccountToApi(updated));
    }),
  });
}

/* ── Query routes ── */

function registerAccountQueryRoutes(http: HttpRouter): void {
  http.route({
    path: '/api/instagram-accounts/for-profile',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const profileId = url.searchParams.get('profileId') || '';
      const status = url.searchParams.get('status') || undefined;
      const accounts = await ctx.runQuery(internal.instagramAccounts.getForProfile, {
        profileId: profileId as any,
        status,
      });
      return jsonResponse(accounts.map(mapAccountToApi));
    }),
  });

  http.route({
    path: '/api/instagram-accounts/by-job',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const jobId = url.searchParams.get('jobId') || '';
      if (!jobId) throw new ValidationError('jobId is required');
      const accounts = await ctx.runQuery(internal.instagramAccounts.listByJobInternal, {
        jobId: jobId as any,
      });
      return jsonResponse(accounts.map(mapAccountToApi));
    }),
  });

  http.route({
    path: '/api/instagram-accounts/to-message',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const profileId = url.searchParams.get('profileId') || '';
      const cooldownHoursRaw =
        url.searchParams.get('cooldownHours') ||
        url.searchParams.get('cooldown_hours') ||
        '0';
      const parsedCooldownHours = Number(cooldownHoursRaw);
      const cooldownHours = Number.isFinite(parsedCooldownHours) ? parsedCooldownHours : 0;
      const accounts = await ctx.runQuery(internal.instagramAccounts.getToMessage, {
        profileId: profileId as any,
        cooldownHours,
      });
      return jsonResponse(accounts.map(mapAccountToApi));
    }),
  });

  http.route({
    path: '/api/instagram-accounts/by-status',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const status = url.searchParams.get('status') || '';
      const accounts = await ctx.runQuery(internal.instagramAccounts.listByStatus, {
        status: status as any,
      });
      return jsonResponse(accounts.map(mapAccountToApi));
    }),
  });

  http.route({
    path: '/api/instagram-accounts/usernames',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const limit = Number(url.searchParams.get('limit') || 200);
      const usernames = await ctx.runQuery(internal.instagramAccounts.listUserNames, {
        limit,
      });
      return jsonResponse(usernames);
    }),
  });

  http.route({
    path: '/api/instagram-accounts/profiles-with-assigned',
    method: 'GET',
    handler: withErrorHandling(async (ctx, request) => {
      const url = new URL(request.url);
      const statusParam = url.searchParams.get('status');
      const status = statusParam === null ? undefined : statusParam;
      const profiles = await ctx.runQuery(
        internal.instagramAccounts.getProfilesWithAssignedAccounts,
        { status },
      );
      return jsonResponse(profiles.map(mapProfileToApi));
    }),
  });
}
