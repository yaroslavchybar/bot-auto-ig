import { httpRouter } from "convex/server";
import { api, internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const internalApi = internal as any;

const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(body: unknown, status: number = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...corsHeaders },
	});
}

function getInternalApiKey(): string | null {
	const token = (globalThis as any)?.process?.env?.INTERNAL_API_KEY as string | undefined;
	const cleaned = typeof token === "string" ? token.trim() : "";
	return cleaned || null;
}

async function requireAuth(request: Request): Promise<Response | null> {
	const token = getInternalApiKey();
	if (!token) {
		return jsonResponse({ error: "Internal API key is not configured" }, 500);
	}
	const auth = request.headers.get("authorization") || "";
	if (auth !== `Bearer ${token}`) return jsonResponse({ error: "Unauthorized" }, 401);
	return null;
}

function toIso(ms: unknown): string | null {
	if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
	return new Date(ms).toISOString();
}

function mapProfileToPython(profile: any, optionsOrIndex?: { includeCookies?: boolean } | number): any {
	if (!profile) return profile;
	const options =
		optionsOrIndex && typeof optionsOrIndex === "object" && !Array.isArray(optionsOrIndex)
			? optionsOrIndex
			: undefined;
	const listIds = Array.isArray(profile.listIds)
		? profile.listIds.filter((id: unknown) => Boolean(id))
		: [];
	const mapped: Record<string, unknown> = {
		profile_id: profile._id,
		created_at: toIso(profile.createdAt),
		name: profile.name,
		proxy: profile.proxy ?? null,
		proxy_type: profile.proxyType ?? null,
		status: profile.status ?? null,
		mode: profile.mode ?? null,
		session_id: typeof profile.sessionId === "string" ? profile.sessionId : null,
		Using: Boolean(profile.using),
		test_ip: Boolean(profile.testIp),
		fingerprint_seed: profile.fingerprintSeed ?? null,
		fingerprint_os: profile.fingerprintOs ?? null,
		list_ids: listIds,
		last_opened_at: toIso(profile.lastOpenedAt),
		login: Boolean(profile.login),
		daily_scraping_limit: typeof profile.dailyScrapingLimit === "number" ? profile.dailyScrapingLimit : null,
		daily_scraping_used: typeof profile.dailyScrapingUsed === "number" ? profile.dailyScrapingUsed : 0,
		scrape_lease_owner: typeof profile.scrapeLeaseOwner === "string" ? profile.scrapeLeaseOwner : null,
		scrape_lease_expires_at: toIso(profile.scrapeLeaseExpiresAt),
		scrape_health: typeof profile.scrapeHealth === "number" ? profile.scrapeHealth : 100,
		last_scrape_failure_at: toIso(profile.lastScrapeFailureAt),
	};
	if (options?.includeCookies) {
		mapped.cookies_json = typeof profile.cookiesJson === "string" ? profile.cookiesJson : null;
	}
	return mapped;
}

function mapAccountToPython(account: any): any {
	if (!account) return account;
	return {
		id: account._id,
		user_name: account.userName,
		full_name: account.fullName ?? null,
		matched_name: account.matchedName ?? null,
		assigned_to: account.assignedTo ?? null,
		status: account.status ?? null,
		message: Boolean(account.message),
		subscribed_at: toIso(account.subscribedAt),
		created_at: toIso(account.createdAt),
	};
}

function mapListToPython(list: any): any {
	if (!list) return list;
	return {
		id: list._id,
		name: list.name,
	};
}

async function parseBody(request: Request): Promise<Record<string, any>> {
	try {
		const body = await request.json();
		return body as Record<string, any>;
	} catch {
		return {};
	}
}

const http = httpRouter();

// CORS preflight handler for all /api/* routes
const corsPreflightHandler = httpAction(async () => {
	return new Response(null, {
		status: 204,
		headers: corsHeaders,
	});
});

// Add OPTIONS handlers for all main API paths
const apiPaths = [
	"/api/profiles",
	"/api/profiles/by-name",
	"/api/profiles/by-id",
	"/api/profiles/available",
	"/api/profiles/by-list-ids",
	"/api/profiles/update-by-name",
	"/api/profiles/update-by-id",
	"/api/profiles/delete-by-id",
	"/api/profiles/remove-by-name",
	"/api/profiles/delete-by-name",
	"/api/profiles/clear-busy-for-lists",
	"/api/profiles/sync-status",
	"/api/profiles/set-login-true",
	"/api/profiles/increment-daily-scraping-used",
	"/api/profiles/claim-scrape-lease",
	"/api/profiles/refresh-scrape-lease",
	"/api/profiles/release-scrape-lease",
	"/api/profiles/mark-scrape-success",
	"/api/profiles/mark-scrape-failure",
	"/api/profiles/sweep-expired-scrape-leases",
	"/api/profiles/assigned",
	"/api/profiles/unassigned",
	"/api/profiles/bulk-set-list-id",
	"/api/profiles/bulk-add-to-list",
	"/api/profiles/bulk-remove-from-list",
	"/api/lists",
	"/api/lists/update",
	"/api/lists/remove",
	"/api/lists/delete",
	"/api/instagram-settings",
	"/api/keywords",
	"/api/keywords/delete",
	"/api/migrations/scraper-auto-only/apply-profile-cleanup",
	"/api/migrations/scraper-auto-only/apply-task-cleanup",
	"/api/migrations/scraper-auto-only/rollback-profile",
	"/api/migrations/scraper-auto-only/rollback-task",
	"/api/message-templates",
	"/api/instagram-accounts",
	"/api/instagram-accounts/batch",
	"/api/instagram-accounts/for-profile",
	"/api/instagram-accounts/to-message",
	"/api/instagram-accounts/update-status",
	"/api/instagram-accounts/update-message",
	"/api/instagram-accounts/usernames",
	"/api/instagram-accounts/profiles-with-assigned",
	"/api/scraping-tasks",
	"/api/scraping-tasks/by-id",
	"/api/scraping-tasks/create",
	"/api/scraping-tasks/update",
	"/api/scraping-tasks/delete",
	"/api/scraping-tasks/start",
	"/api/scraping-tasks/pause",
	"/api/scraping-tasks/resume",
	"/api/scraping-tasks/cancel",
	"/api/scraping-tasks/claim-next",
	"/api/scraping-tasks/lease-profile",
	"/api/scraping-tasks/note-running",
	"/api/scraping-tasks/heartbeat",
	"/api/scraping-tasks/store-chunk",
	"/api/scraping-tasks/finalize",
	"/api/scraping-tasks/record-retry",
	"/api/scraping-tasks/record-failure",
	"/api/scraping-tasks/sweep-expired-leases",
	"/api/scraping-tasks/storage-url",
	"/api/scraping-tasks/manifest-url",
	"/api/scraping-tasks/unimported",
	"/api/scraping-tasks/set-imported",
	"/api/workflows",
	"/api/workflows/by-id",
	"/api/workflows/start",
	"/api/workflows/update-status",
];

for (const path of apiPaths) {
	http.route({ path, method: "OPTIONS", handler: corsPreflightHandler });
}

http.route({
	path: "/api/profiles",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const profiles = await ctx.runQuery(internal.profiles.listInternal, {});
			return jsonResponse(profiles.map(mapProfileToPython));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/by-name",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const url = new URL(request.url);
			const name = url.searchParams.get("name") || "";
			const profile = await ctx.runQuery(internalApi.profiles.getByNameInternal, { name });
			return jsonResponse(mapProfileToPython(profile, { includeCookies: true }));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/by-id",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const url = new URL(request.url);
			const profileId = url.searchParams.get("profileId") || url.searchParams.get("profile_id") || "";
			const profile = profileId
				? await ctx.runQuery(internal.profiles.getByIdInternal, { profileId: profileId as any })
				: null;
			return jsonResponse(mapProfileToPython(profile, { includeCookies: true }));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/available",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const listIds = (body?.listIds ?? body?.list_ids ?? []) as any[];
			const cooldownMinutes = body?.cooldownMinutes ?? body?.cooldown_minutes ?? 0;
			const profiles = await ctx.runQuery(internalApi.profiles.getAvailableForListsInternal, {
				listIds,
				cooldownMinutes,
			});
			return jsonResponse(profiles.map(mapProfileToPython));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/by-list-ids",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const listIds = (body?.listIds ?? body?.list_ids ?? []) as any[];
			const profiles = await ctx.runQuery(internalApi.profiles.getByListIdsInternal, { listIds });
			return jsonResponse(profiles.map(mapProfileToPython));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const created = await ctx.runMutation(internalApi.profiles.createInternal, {
				name: body?.name,
				proxy: body?.proxy ?? undefined,
				proxyType: body?.proxyType ?? body?.proxy_type ?? undefined,
				fingerprintSeed: body?.fingerprintSeed ?? body?.fingerprint_seed ?? undefined,
				fingerprintOs: body?.fingerprintOs ?? body?.fingerprint_os ?? undefined,
				cookiesJson: body?.cookiesJson ?? body?.cookies_json ?? undefined,
				testIp: body?.testIp ?? body?.test_ip ?? undefined,
				sessionId: body?.sessionId ?? body?.session_id ?? undefined,
				dailyScrapingLimit: body?.dailyScrapingLimit ?? body?.daily_scraping_limit ?? undefined,
			});
			return jsonResponse(mapProfileToPython(created, { includeCookies: true }));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/update-by-name",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const updated = await ctx.runMutation(internalApi.profiles.updateByNameInternal, {
				oldName: body?.oldName ?? body?.old_name,
				name: body?.name,
				proxy: body?.proxy ?? undefined,
				proxyType: body?.proxyType ?? body?.proxy_type ?? undefined,
				fingerprintSeed: body?.fingerprintSeed ?? body?.fingerprint_seed ?? undefined,
				fingerprintOs: body?.fingerprintOs ?? body?.fingerprint_os ?? undefined,
				cookiesJson: body?.cookiesJson ?? body?.cookies_json ?? undefined,
				testIp: body?.testIp ?? body?.test_ip ?? undefined,
				sessionId: body?.sessionId ?? body?.session_id ?? undefined,
				dailyScrapingLimit: body?.dailyScrapingLimit ?? body?.daily_scraping_limit ?? undefined,
			} as any);
			return jsonResponse(mapProfileToPython(updated, { includeCookies: true }));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/update-by-id",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const updated = await ctx.runMutation(internalApi.profiles.updateByIdInternal, {
				profileId: (body?.profileId ?? body?.profile_id) as any,
				name: body?.name,
				proxy: body?.proxy ?? undefined,
				proxyType: body?.proxyType ?? body?.proxy_type ?? undefined,
				fingerprintSeed: body?.fingerprintSeed ?? body?.fingerprint_seed ?? undefined,
				fingerprintOs: body?.fingerprintOs ?? body?.fingerprint_os ?? undefined,
				cookiesJson: body?.cookiesJson ?? body?.cookies_json ?? undefined,
				testIp: body?.testIp ?? body?.test_ip ?? undefined,
				sessionId: body?.sessionId ?? body?.session_id ?? undefined,
				dailyScrapingLimit: body?.dailyScrapingLimit ?? body?.daily_scraping_limit ?? undefined,
			});
			return jsonResponse(mapProfileToPython(updated, { includeCookies: true }));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/delete-by-id",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const ok = await ctx.runMutation(internalApi.profiles.removeByIdInternal, {
				profileId: (body?.profileId ?? body?.profile_id) as any,
			});
			return jsonResponse({ ok });
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/remove-by-name",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const ok = await ctx.runMutation(internalApi.profiles.removeByNameInternal, body as any);
			return jsonResponse({ ok });
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

// Alias for /api/profiles/remove-by-name
http.route({
	path: "/api/profiles/delete-by-name",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const ok = await ctx.runMutation(internalApi.profiles.removeByNameInternal, body as any);
			return jsonResponse({ ok });
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/clear-busy-for-lists",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const listIds = body?.listIds ?? body?.list_ids ?? [];
			const ok = await ctx.runMutation(internalApi.profiles.clearBusyForListsInternal, {
				listIds: listIds as any[],
			});
			return jsonResponse({ ok });
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/sync-status",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const ok = await ctx.runMutation(internalApi.profiles.syncStatusInternal, body as any);
			return jsonResponse({ ok });
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/set-login-true",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const ok = await ctx.runMutation(internalApi.profiles.setLoginTrueInternal, body as any);
			return jsonResponse({ ok });
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/increment-daily-scraping-used",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const ok = await ctx.runMutation(internal.profiles.incrementDailyScrapingUsedInternal, body as any);
			return jsonResponse({ ok });
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/claim-scrape-lease",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const profile = await ctx.runMutation(internal.profiles.claimBestScrapeLeaseInternal, {
				workerId: body?.workerId,
				leaseMs: body?.leaseMs,
				now: body?.now ?? Date.now(),
				minHealth: body?.minHealth,
			});
			return jsonResponse(mapProfileToPython(profile));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/refresh-scrape-lease",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const profile = await ctx.runMutation(internal.profiles.refreshScrapeLeaseInternal, {
				profileId: body?.profileId,
				workerId: body?.workerId,
				leaseMs: body?.leaseMs,
				now: body?.now ?? Date.now(),
			});
			return jsonResponse(mapProfileToPython(profile));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/release-scrape-lease",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const ok = await ctx.runMutation(internal.profiles.releaseScrapeLeaseInternal, {
				profileId: body?.profileId,
				workerId: body?.workerId,
			});
			return jsonResponse({ ok });
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/mark-scrape-success",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const profile = await ctx.runMutation(internal.profiles.markScrapeSuccessInternal, {
				profileId: body?.profileId,
				workerId: body?.workerId,
				amount: body?.amount,
				now: body?.now ?? Date.now(),
			});
			return jsonResponse(mapProfileToPython(profile));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/mark-scrape-failure",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const profile = await ctx.runMutation(internal.profiles.markScrapeFailureInternal, {
				profileId: body?.profileId,
				workerId: body?.workerId,
				now: body?.now ?? Date.now(),
			});
			return jsonResponse(mapProfileToPython(profile));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/sweep-expired-scrape-leases",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const result = await ctx.runMutation(internal.profiles.sweepExpiredScrapeLeasesInternal, {
				now: body?.now ?? Date.now(),
			});
			return jsonResponse(result);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/lists",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const lists = await ctx.runQuery(api.lists.list, {});
			return jsonResponse(lists.map(mapListToPython));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/lists",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const created = await ctx.runMutation(api.lists.create, body as any);
			return jsonResponse(mapListToPython(created));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/lists/update",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const updated = await ctx.runMutation(api.lists.update, body as any);
			return jsonResponse(mapListToPython(updated));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/lists/remove",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const ok = await ctx.runMutation(api.lists.remove, body as any);
			return jsonResponse({ ok });
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

// Alias for /api/lists/remove
http.route({
	path: "/api/lists/delete",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const ok = await ctx.runMutation(api.lists.remove, body as any);
			return jsonResponse({ ok });
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/assigned",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const url = new URL(request.url);
			const listId = url.searchParams.get("list_id");
			if (!listId) return jsonResponse({ error: "list_id is required" }, 400);
			const profiles = await ctx.runQuery(internalApi.profiles.listAssignedInternal, { listId: listId as any });
			return jsonResponse(profiles.map((p: any) => ({ profile_id: p.profileId, name: p.name })));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/unassigned",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const profiles = await ctx.runQuery(internalApi.profiles.listUnassignedInternal, {});
			return jsonResponse(profiles.map((p: any) => ({ profile_id: p.profileId, name: p.name })));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/bulk-set-list-id",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const profileIds = body?.profileIds ?? body?.profile_ids ?? [];
			const listId = body?.listId ?? body?.list_id;
			const ok = await ctx.runMutation(internalApi.profiles.bulkSetListIdInternal, {
				profileIds: profileIds as any[],
				listId: listId === null ? null : (listId as any),
			});
			return jsonResponse({ ok });
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/bulk-add-to-list",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const profileIds = body?.profileIds ?? body?.profile_ids ?? [];
			const listId = body?.listId ?? body?.list_id;
			const ok = await ctx.runMutation(internalApi.profiles.bulkAddToListInternal, {
				profileIds: profileIds as any[],
				listId: listId as any,
			});
			return jsonResponse({ ok });
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/bulk-remove-from-list",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const profileIds = body?.profileIds ?? body?.profile_ids ?? [];
			const listId = body?.listId ?? body?.list_id;
			const ok = await ctx.runMutation(internalApi.profiles.bulkRemoveFromListInternal, {
				profileIds: profileIds as any[],
				listId: listId as any,
			});
			return jsonResponse({ ok });
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/keywords",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const url = new URL(request.url);
			const filename = (url.searchParams.get("filename") || "").trim();
			if (filename) {
				const content = await ctx.runQuery(internal.keywords.get, { filename });
				return jsonResponse(content);
			}
			const keywords = await ctx.runQuery(internal.keywords.list, {});
			return jsonResponse(keywords);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/keywords",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const result = await ctx.runMutation(internal.keywords.upsert, {
				filename: body?.filename,
				content: body?.content,
			});
			return jsonResponse(result);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/keywords/delete",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const result = await ctx.runMutation(internal.keywords.remove, {
				filename: body?.filename,
			});
			return jsonResponse(result);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/migrations/scraper-auto-only/apply-profile-cleanup",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const result = await ctx.runMutation(internal.migrations.scraperAutoOnlyApplyProfileCleanup, {
				profileId: body?.profileId,
			});
			return jsonResponse(result);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/migrations/scraper-auto-only/apply-task-cleanup",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const result = await ctx.runMutation(internal.migrations.scraperAutoOnlyApplyTaskCleanup, {
				taskId: body?.taskId,
			});
			return jsonResponse(result);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/migrations/scraper-auto-only/rollback-profile",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const result = await ctx.runMutation(internal.migrations.scraperAutoOnlyRollbackProfile, {
				profileId: body?.profileId,
				hadAutomation: body?.hadAutomation,
				automation: body?.automation,
			});
			return jsonResponse(result);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/migrations/scraper-auto-only/rollback-task",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const result = await ctx.runMutation(internal.migrations.scraperAutoOnlyRollbackTask, {
				taskId: body?.taskId,
				snapshot: body?.snapshot,
			});
			return jsonResponse(result);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/message-templates",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const url = new URL(request.url);
			const kind = url.searchParams.get("kind") || "";
			const texts = await ctx.runQuery(api.messageTemplates.get, { kind });
			return jsonResponse(texts);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/message-templates",
	method: "POST",
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

http.route({
	path: "/api/instagram-accounts",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const created = await ctx.runMutation(internal.instagramAccounts.insert, {
				userName: body?.userName ?? body?.user_name,
				fullName: body?.fullName ?? body?.full_name,
				matchedName: body?.matchedName ?? body?.matched_name,
				status: body?.status,
				message: body?.message,
				createdAt: body?.createdAt ?? body?.created_at,
			});
			return jsonResponse(created);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/instagram-accounts/batch",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const result = await ctx.runMutation(internal.instagramAccounts.insertBatch, {
				accounts: Array.isArray(body?.accounts) ? body.accounts : [],
			});
			return jsonResponse(result);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/instagram-accounts/for-profile",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const url = new URL(request.url);
			const profileId = url.searchParams.get("profileId") || "";
			const status = url.searchParams.get("status") || undefined;
			const accounts = await ctx.runQuery(internal.instagramAccounts.getForProfile, {
				profileId: profileId as any,
				status,
			});
			return jsonResponse(accounts.map(mapAccountToPython));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/instagram-accounts/to-message",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
			const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const url = new URL(request.url);
			const profileId = url.searchParams.get("profileId") || "";
			const accounts = await ctx.runQuery(internal.instagramAccounts.getToMessage, { profileId: profileId as any });
			return jsonResponse(accounts.map(mapAccountToPython));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/instagram-accounts/update-status",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const updated = await ctx.runMutation(internal.instagramAccounts.updateStatus, {
				accountId: (body?.accountId ?? body?.account_id ?? body?.id) as any,
				status: body?.status,
				assignedTo: typeof body?.assigned_to !== "undefined" ? body.assigned_to : body?.assignedTo,
			});
			return jsonResponse(mapAccountToPython(updated));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/instagram-accounts/update-message",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const updated = await ctx.runMutation(internal.instagramAccounts.updateMessage, {
				userName: body?.userName ?? body?.user_name,
				message: body?.message,
			});
			return jsonResponse(mapAccountToPython(updated));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});


http.route({
	path: "/api/instagram-accounts/usernames",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const url = new URL(request.url);
			const limit = Number(url.searchParams.get("limit") || 200);
			const usernames = await ctx.runQuery(internal.instagramAccounts.listUserNames, { limit });
			return jsonResponse(usernames);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/instagram-accounts/profiles-with-assigned",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const url = new URL(request.url);
			const statusParam = url.searchParams.get("status");
			const status = statusParam === null ? undefined : statusParam;
			const profiles = await ctx.runQuery(internal.instagramAccounts.getProfilesWithAssignedAccounts, { status });
			return jsonResponse(profiles.map(mapProfileToPython));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

// ==================== SCRAPING TASKS ====================

http.route({
	path: "/api/scraping-tasks",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const url = new URL(request.url);
			const kind = url.searchParams.get("kind") || undefined;
			const tasks = await ctx.runQuery(internal.scrapingTasks.listInternal, { kind: kind as any });
			return jsonResponse(tasks);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/scraping-tasks/create",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const task = await ctx.runMutation(internal.scrapingTasks.createInternal, {
				name: body?.name,
				kind: body?.kind,
				targetUsername: body?.targetUsername ?? body?.target_username,
				targets: body?.targets,
				maxAttempts: body?.maxAttempts ?? body?.max_attempts,
			});
			return jsonResponse(task);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/scraping-tasks/update",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const task = await ctx.runMutation(api.scrapingTasks.update, {
				id: body?.id ?? body?.taskId,
				name: body?.name,
				kind: body?.kind,
				targetUsername: body?.targetUsername ?? body?.target_username,
				targets: body?.targets,
				maxAttempts: body?.maxAttempts ?? body?.max_attempts,
			});
			return jsonResponse(task);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/scraping-tasks/delete",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const ok = await ctx.runMutation(api.scrapingTasks.remove, {
				id: body?.id ?? body?.taskId,
			});
			return jsonResponse({ ok });
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/scraping-tasks/by-id",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const url = new URL(request.url);
			const id = url.searchParams.get("id") || url.searchParams.get("taskId") || "";
			if (!id) return jsonResponse({ error: "id is required" }, 400);
			const task = await ctx.runQuery(internal.scrapingTasks.getByIdInternal, { id: id as any });
			return jsonResponse(task);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/scraping-tasks/start",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const task = await ctx.runMutation(internal.scrapingTasks.startInternal, {
				id: body?.id ?? body?.taskId,
			} as any);
			return jsonResponse(task);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/scraping-tasks/pause",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const task = await ctx.runMutation(internal.scrapingTasks.pauseInternal, {
				id: body?.id ?? body?.taskId,
			} as any);
			return jsonResponse(task);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/scraping-tasks/resume",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const task = await ctx.runMutation(internal.scrapingTasks.resumeInternal, {
				id: body?.id ?? body?.taskId,
			} as any);
			return jsonResponse(task);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/scraping-tasks/cancel",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const task = await ctx.runMutation(internal.scrapingTasks.cancelInternal, {
				id: body?.id ?? body?.taskId,
			} as any);
			return jsonResponse(task);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/scraping-tasks/claim-next",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const task = await ctx.runMutation(internal.scrapingTasks.claimNextInternal, {
				workerId: body?.workerId ?? body?.worker_id,
				now: body?.now,
				leaseMs: body?.leaseMs ?? body?.lease_ms,
			} as any);
			return jsonResponse(task);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/scraping-tasks/lease-profile",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const profile = await ctx.runMutation(internal.profiles.claimBestScrapeLeaseInternal, {
				workerId: body?.workerId ?? body?.worker_id,
				now: body?.now,
				leaseMs: body?.leaseMs ?? body?.lease_ms,
				minHealth: body?.minHealth ?? body?.min_health,
			} as any);
			return jsonResponse(profile);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/scraping-tasks/note-running",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const task = await ctx.runMutation(internal.scrapingTasks.noteRunningInternal, {
				taskId: body?.taskId ?? body?.task_id,
				workerId: body?.workerId ?? body?.worker_id,
				profileId: body?.profileId ?? body?.profile_id,
				now: body?.now,
				leaseMs: body?.leaseMs ?? body?.lease_ms,
			} as any);
			return jsonResponse(task);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/scraping-tasks/heartbeat",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const task = await ctx.runMutation(internal.scrapingTasks.heartbeatInternal, {
				taskId: body?.taskId ?? body?.task_id,
				workerId: body?.workerId ?? body?.worker_id,
				now: body?.now,
				leaseMs: body?.leaseMs ?? body?.lease_ms,
			} as any);
			return jsonResponse(task);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/scraping-tasks/unimported",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const url = new URL(request.url);
			const kind = url.searchParams.get("kind") || undefined;
			const tasks = await ctx.runQuery(internal.scrapingTasks.listUnimportedInternal, {
				kind: kind as any,
			});
			return jsonResponse(tasks);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/scraping-tasks/store-chunk",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const now = Number.isFinite(Number(body?.now)) ? Math.floor(Number(body.now)) : Date.now();
			const users = Array.isArray(body?.users) ? body.users : [];
			const payload = {
				taskId: body?.taskId ?? body?.task_id,
				targetUsername: body?.targetUsername ?? body?.target_username,
				profileId: body?.profileId ?? body?.profile_id,
				scrapedAt: now,
				count: users.length,
				users,
			};
			const stored = await ctx.runAction(internal.scrapingTasks.storeArtifactInternal, {
				payload,
			});
			const task = await ctx.runMutation(internal.scrapingTasks.appendChunkInternal, {
				taskId: body?.taskId ?? body?.task_id,
				workerId: body?.workerId ?? body?.worker_id,
				now,
				storageId: stored.storageId,
				targetUsername: body?.targetUsername ?? body?.target_username,
				scraped: users.length,
				hasMore: Boolean(body?.hasMore ?? body?.has_more),
				nextCursor: body?.nextCursor ?? body?.next_cursor ?? undefined,
				sourceProfileId: body?.profileId ?? body?.profile_id,
				sourceProfileName: body?.profileName ?? body?.profile_name,
			} as any);

			const taskStats = task?.stats ?? {
				scraped: 0,
				deduped: 0,
				chunksCompleted: 0,
				targetsCompleted: 0,
			};
			const taskTargets = Array.isArray(task?.targets) ? task.targets : [];
			const currentTargetIndex =
				typeof task?.currentTargetIndex === "number" ? task.currentTargetIndex : 0;
			const done = currentTargetIndex >= taskTargets.length;
			const nextTargetUsername =
				!done && currentTargetIndex >= 0 && currentTargetIndex < taskTargets.length
					? taskTargets[currentTargetIndex]
					: null;

			return jsonResponse({
				storageId: stored.storageId,
				count: users.length,
				done,
				stats: taskStats,
				currentTargetIndex,
				nextTargetUsername,
			});
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/scraping-tasks/finalize",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const now = Number.isFinite(Number(body?.now)) ? Math.floor(Number(body.now)) : Date.now();
			const taskId = body?.taskId ?? body?.task_id;
			const task = await ctx.runQuery(internal.scrapingTasks.getByIdInternal, {
				id: taskId,
			} as any);
			if (!task) {
				return jsonResponse({ error: "Task not found" }, 404);
			}

			const manifestPayload = {
				taskId,
				name: task.name,
				kind: task.kind,
				targets: Array.isArray(task.targets) ? task.targets : [],
				stats: task.stats ?? {
					scraped: 0,
					deduped: 0,
					chunksCompleted: 0,
					targetsCompleted: 0,
				},
				chunks: Array.isArray(task.chunkRefs) ? task.chunkRefs : [],
				completedAt: now,
			};
			const stored = await ctx.runAction(internal.scrapingTasks.storeArtifactInternal, {
				payload: manifestPayload,
			});
			const completed = await ctx.runMutation(internal.scrapingTasks.markCompletedInternal, {
				taskId,
				workerId: body?.workerId ?? body?.worker_id,
				now,
				manifestStorageId: stored.storageId,
				exportStorageId: body?.exportStorageId ?? body?.export_storage_id ?? undefined,
				deduped: body?.deduped ?? task?.stats?.deduped ?? 0,
			} as any);

			return jsonResponse({
				manifestStorageId: stored.storageId,
				stats: completed?.stats ?? manifestPayload.stats,
				chunkCount: Array.isArray(task.chunkRefs) ? task.chunkRefs.length : 0,
			});
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/scraping-tasks/record-retry",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const result = await ctx.runMutation(internal.scrapingTasks.markRetryInternal, {
				taskId: body?.taskId ?? body?.task_id,
				workerId: body?.workerId ?? body?.worker_id,
				now: body?.now,
				errorCode: body?.errorCode ?? body?.error_code,
				errorMessage: body?.errorMessage ?? body?.error_message,
				retryDelayMs:
					body?.retryDelayMs ??
					body?.retry_delay_ms ??
					(typeof body?.nextRunAt === "number" && typeof body?.now === "number"
						? Math.max(1_000, body.nextRunAt - body.now)
						: 30_000),
			} as any);
			return jsonResponse(result);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/scraping-tasks/record-failure",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const result = await ctx.runMutation(internal.scrapingTasks.markFailedInternal, {
				taskId: body?.taskId ?? body?.task_id,
				workerId: body?.workerId ?? body?.worker_id,
				now: body?.now,
				errorCode: body?.errorCode ?? body?.error_code,
				errorMessage: body?.errorMessage ?? body?.error_message,
			} as any);
			return jsonResponse(result);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/scraping-tasks/set-imported",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const task = await ctx.runMutation(internal.scrapingTasks.setImportedInternal, {
				id: body?.id ?? body?.taskId,
				imported: body?.imported,
			});
			return jsonResponse(task);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/scraping-tasks/sweep-expired-leases",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const result = await ctx.runMutation(internal.scrapingTasks.recoverExpiredLeasesInternal, {
				now: body?.now,
			});
			return jsonResponse(result);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/scraping-tasks/store-data",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const result = await ctx.runAction(internal.scrapingTasks.storeScrapedData, {
				taskId: body?.taskId ?? body?.task_id,
				users: Array.isArray(body?.users) ? body.users : [],
				metadata: body?.metadata ?? {},
			} as any);
			return jsonResponse(result);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/scraping-tasks/store-artifact",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const result = await ctx.runAction(internal.scrapingTasks.storeArtifactInternal, {
				payload: body?.payload ?? {},
			});
			return jsonResponse(result);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/scraping-tasks/storage-url",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const url = new URL(request.url);
			const storageId = url.searchParams.get("storageId") || url.searchParams.get("storage_id") || "";

			if (!storageId) {
				return jsonResponse({ error: "storageId is required" }, 400);
			}

			const fileUrl = await ctx.runQuery(internal.scrapingTasks.getStorageUrlInternal, {
				storageId: storageId as any,
			});

			return jsonResponse(fileUrl);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/scraping-tasks/manifest-url",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const url = new URL(request.url);
			const id = url.searchParams.get("id") || url.searchParams.get("taskId") || "";
			if (!id) {
				return jsonResponse({ error: "id is required" }, 400);
			}
			const fileUrl = await ctx.runQuery(internal.scrapingTasks.getManifestUrlInternal, {
				id: id as any,
			});
			return jsonResponse(fileUrl);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

// ==================== WORKFLOWS ====================

http.route({
	path: "/api/workflows",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const url = new URL(request.url);
			const status = url.searchParams.get("status") || undefined;
			const rows = await ctx.runQuery(api.workflows.list, {
				status: status as any,
			});
			return jsonResponse(rows);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/workflows/by-id",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const url = new URL(request.url);
			const workflowId = url.searchParams.get("workflowId") || url.searchParams.get("id") || "";
			if (!workflowId) return jsonResponse({ error: "workflowId is required" }, 400);
			const row = await ctx.runQuery(api.workflows.get, { id: workflowId as any });
			return jsonResponse(row);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/workflows/start",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const id = body?.id ?? body?.workflowId ?? body?.workflow_id;
			if (!id) return jsonResponse({ error: "id is required" }, 400);
			const row = await ctx.runMutation(api.workflows.start, { id: id as any });
			return jsonResponse(row);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/workflows/update-status",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const id = body?.id ?? body?.workflowId ?? body?.workflow_id;
			if (!id) return jsonResponse({ error: "id is required" }, 400);
			const row = await ctx.runMutation(api.workflows.updateStatus, {
				id: id as any,
				status: body?.status,
				currentNodeId: body?.currentNodeId ?? body?.current_node_id,
				nodeStates: body?.nodeStates ?? body?.node_states,
				error: body?.error,
			});
			return jsonResponse(row);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

export default http;
