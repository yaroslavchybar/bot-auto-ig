import { httpRouter } from "convex/server";
import { api } from "./_generated/api";
import { httpAction } from "./_generated/server";

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

async function requireAuth(request: Request): Promise<Response | null> {
	const token = (globalThis as any)?.process?.env?.CONVEX_API_KEY as string | undefined;
	if (!token) return null;
	const auth = request.headers.get("authorization") || "";
	if (auth !== `Bearer ${token}`) return jsonResponse({ error: "Unauthorized" }, 401);
	return null;
}

function toIso(ms: unknown): string | null {
	if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
	return new Date(ms).toISOString();
}

function mapProfileToPython(profile: any): any {
	if (!profile) return profile;
	return {
		profile_id: profile._id,
		created_at: toIso(profile.createdAt),
		name: profile.name,
		proxy: profile.proxy ?? null,
		proxy_type: profile.proxyType ?? null,
		status: profile.status ?? null,
		mode: profile.mode ?? null,
		automation: typeof profile.automation === "boolean" ? profile.automation : false,
		session_id: typeof profile.sessionId === "string" ? profile.sessionId : null,
		Using: Boolean(profile.using),
		test_ip: Boolean(profile.testIp),
		fingerprint_seed: profile.fingerprintSeed ?? null,
		fingerprint_os: profile.fingerprintOs ?? null,
		list_id: profile.listId ?? null,
		sessions_today: typeof profile.sessionsToday === "number" ? profile.sessionsToday : 0,
		last_opened_at: toIso(profile.lastOpenedAt),
		login: Boolean(profile.login),
	};
}

function mapAccountToPython(account: any): any {
	if (!account) return account;
	return {
		id: account._id,
		user_name: account.userName,
		assigned_to: account.assignedTo ?? null,
		status: account.status ?? null,
		link_sent: account.linkSent ?? null,
		message: Boolean(account.message),
		subscribed_at: toIso(account.subscribedAt),
		last_message_sent_at: toIso(account.lastMessageSentAt),
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
	"/api/profiles/increment-sessions-today",
	"/api/profiles/assigned",
	"/api/profiles/unassigned",
	"/api/profiles/bulk-set-list-id",
	"/api/lists",
	"/api/lists/update",
	"/api/lists/remove",
	"/api/lists/delete",
	"/api/instagram-settings",
	"/api/message-templates",
	"/api/instagram-accounts/for-profile",
	"/api/instagram-accounts/to-message",
	"/api/instagram-accounts/update-status",
	"/api/instagram-accounts/update-message",
	"/api/instagram-accounts/update-link-sent",
	"/api/instagram-accounts/set-last-message-sent-now",
	"/api/instagram-accounts/last-message-sent-at",
	"/api/instagram-accounts/usernames",
	"/api/instagram-accounts/profiles-with-assigned",
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
			const profiles = await ctx.runQuery(api.profiles.list, {});
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
			const profile = await ctx.runQuery(api.profiles.getByName, { name });
			return jsonResponse(mapProfileToPython(profile));
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
			const profile = await ctx.runQuery(api.profiles.getById, { profileId: profileId as any });
			return jsonResponse(mapProfileToPython(profile));
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
			const maxSessions = body?.maxSessions ?? body?.max_sessions ?? 0;
			const cooldownMinutes = body?.cooldownMinutes ?? body?.cooldown_minutes ?? 0;
			const profiles = await ctx.runQuery(api.profiles.getAvailableForLists, {
				listIds,
				maxSessions,
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
			const profiles = await ctx.runQuery(api.profiles.getByListIds, { listIds });
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
			const created = await ctx.runMutation(api.profiles.create, {
				name: body?.name,
				proxy: body?.proxy ?? undefined,
				proxyType: body?.proxyType ?? body?.proxy_type ?? undefined,
				fingerprintSeed: body?.fingerprintSeed ?? body?.fingerprint_seed ?? undefined,
				fingerprintOs: body?.fingerprintOs ?? body?.fingerprint_os ?? undefined,
				testIp: body?.testIp ?? body?.test_ip ?? undefined,
				automation: body?.automation ?? undefined,
				sessionId: body?.sessionId ?? body?.session_id ?? undefined,
			});
			return jsonResponse(mapProfileToPython(created));
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
			const updated = await ctx.runMutation(api.profiles.updateByName, {
				oldName: body?.oldName ?? body?.old_name,
				name: body?.name,
				proxy: body?.proxy ?? undefined,
				proxyType: body?.proxyType ?? body?.proxy_type ?? undefined,
				fingerprintSeed: body?.fingerprintSeed ?? body?.fingerprint_seed ?? undefined,
				fingerprintOs: body?.fingerprintOs ?? body?.fingerprint_os ?? undefined,
				testIp: body?.testIp ?? body?.test_ip ?? undefined,
				automation: body?.automation ?? undefined,
				sessionId: body?.sessionId ?? body?.session_id ?? undefined,
			} as any);
			return jsonResponse(mapProfileToPython(updated));
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
			const updated = await ctx.runMutation(api.profiles.updateById, {
				profileId: (body?.profileId ?? body?.profile_id) as any,
				name: body?.name,
				proxy: body?.proxy ?? undefined,
				proxyType: body?.proxyType ?? body?.proxy_type ?? undefined,
				fingerprintSeed: body?.fingerprintSeed ?? body?.fingerprint_seed ?? undefined,
				fingerprintOs: body?.fingerprintOs ?? body?.fingerprint_os ?? undefined,
				testIp: body?.testIp ?? body?.test_ip ?? undefined,
				automation: body?.automation ?? undefined,
				sessionId: body?.sessionId ?? body?.session_id ?? undefined,
			});
			return jsonResponse(mapProfileToPython(updated));
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
			const ok = await ctx.runMutation(api.profiles.removeById, { profileId: (body?.profileId ?? body?.profile_id) as any });
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
			const ok = await ctx.runMutation(api.profiles.removeByName, body as any);
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
			const ok = await ctx.runMutation(api.profiles.removeByName, body as any);
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
			const ok = await ctx.runMutation(api.profiles.clearBusyForLists, { listIds: listIds as any[] });
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
			const ok = await ctx.runMutation(api.profiles.syncStatus, body as any);
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
			const ok = await ctx.runMutation(api.profiles.setLoginTrue, body as any);
			return jsonResponse({ ok });
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/profiles/increment-sessions-today",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const ok = await ctx.runMutation(api.profiles.incrementSessionsToday, body as any);
			return jsonResponse({ ok });
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
			const profiles = await ctx.runQuery(api.profiles.listAssigned, { listId: listId as any });
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
			const profiles = await ctx.runQuery(api.profiles.listUnassigned, {});
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
			const ok = await ctx.runMutation(api.profiles.bulkSetListId, {
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
	path: "/api/instagram-settings",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const url = new URL(request.url);
			const scope = url.searchParams.get("scope") || undefined;
			const data = await ctx.runQuery(api.instagramSettings.get, { scope });
			return jsonResponse(data);
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/instagram-settings",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const data = await ctx.runMutation(api.instagramSettings.upsert, body as any);
			return jsonResponse(data);
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
	path: "/api/instagram-accounts/for-profile",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const url = new URL(request.url);
			const profileId = url.searchParams.get("profileId") || "";
			const status = url.searchParams.get("status") || undefined;
			const accounts = await ctx.runQuery(api.instagramAccounts.getForProfile, {
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
			const accounts = await ctx.runQuery(api.instagramAccounts.getToMessage, { profileId: profileId as any });
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
			const updated = await ctx.runMutation(api.instagramAccounts.updateStatus, {
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
			const updated = await ctx.runMutation(api.instagramAccounts.updateMessage, {
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
	path: "/api/instagram-accounts/update-link-sent",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const updated = await ctx.runMutation(api.instagramAccounts.updateLinkSent, {
				userName: body?.userName ?? body?.user_name,
				linkSent: body?.linkSent ?? body?.link_sent,
			});
			return jsonResponse(mapAccountToPython(updated));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/instagram-accounts/set-last-message-sent-now",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const body = await parseBody(request);
			const updated = await ctx.runMutation(api.instagramAccounts.setLastMessageSentNow, {
				accountId: (body?.accountId ?? body?.account_id ?? body?.id) as any,
			});
			return jsonResponse(mapAccountToPython(updated));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

http.route({
	path: "/api/instagram-accounts/last-message-sent-at",
	method: "GET",
	handler: httpAction(async (ctx, request) => {
		const authError = await requireAuth(request);
		if (authError) return authError;
		try {
			const url = new URL(request.url);
			const accountId = url.searchParams.get("accountId") || url.searchParams.get("account_id") || url.searchParams.get("id") || "";
			const value = await ctx.runQuery(api.instagramAccounts.getLastMessageSentAt, { accountId: accountId as any });
			return jsonResponse(value ? toIso(value) : null);
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
			const usernames = await ctx.runQuery(api.instagramAccounts.listUserNames, { limit });
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
			const profiles = await ctx.runQuery(api.instagramAccounts.getProfilesWithAssignedAccounts, { status });
			return jsonResponse(profiles.map(mapProfileToPython));
		} catch (err: any) {
			return jsonResponse({ error: String(err?.message || err) }, 400);
		}
	}),
});

export default http;
