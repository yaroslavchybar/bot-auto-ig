export function computeProfileMode(proxy: unknown): "proxy" | "direct" {
	const s = typeof proxy === "string" ? proxy.trim() : "";
	return s ? "proxy" : "direct";
}

export function getProfileListIds(profile: any): any[] {
	const merged = Array.isArray(profile?.listIds) ? profile.listIds : [];
	const seen = new Set<string>();
	const deduped: any[] = [];
	for (const id of merged) {
		const key = String(id || "").trim();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		deduped.push(id);
	}
	return deduped;
}

export function buildListPatch(listIds: any[]): { listIds: any[] } {
	return {
		listIds,
	};
}

export function normalizeDailyScrapingLimit(limit: unknown): number | undefined {
	if (limit === null || typeof limit === "undefined") return undefined;
	const numeric = Number(limit);
	if (!Number.isFinite(numeric)) return undefined;
	return Math.max(0, Math.floor(numeric));
}

export function normalizeScrapeHealth(value: unknown): number {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return 100;
	return Math.max(0, Math.min(100, Math.floor(numeric)));
}

export function hasRemainingDailyCapacity(profile: any): boolean {
	const limit = typeof profile.dailyScrapingLimit === "number" ? profile.dailyScrapingLimit : null;
	const used = typeof profile.dailyScrapingUsed === "number" ? profile.dailyScrapingUsed : 0;
	return limit === null || used < limit;
}

export function hasActiveScrapeLease(profile: any, now: number): boolean {
	const owner = typeof profile.scrapeLeaseOwner === "string" ? profile.scrapeLeaseOwner.trim() : "";
	const expiresAt = typeof profile.scrapeLeaseExpiresAt === "number" ? profile.scrapeLeaseExpiresAt : 0;
	return Boolean(owner) && expiresAt > now;
}

export async function listProfileRows(ctx: any) {
	const rows = await ctx.db.query("profiles").collect();
	rows.sort((a: any, b: any) => a.createdAt - b.createdAt);
	return rows;
}

export async function incrementDailyScrapingUsedByName(ctx: any, name: string, amountRaw: number) {
	const cleanedName = String(name || "").trim();
	if (!cleanedName) throw new Error("name is required");
	const amount = Number.isFinite(amountRaw) ? Math.max(0, Math.floor(amountRaw)) : 0;
	if (amount === 0) return true;
	const existing = await ctx.db
		.query("profiles")
		.withIndex("by_name", (q: any) => q.eq("name", cleanedName))
		.first();
	if (!existing) return true;
	await ctx.db.patch(existing._id, { dailyScrapingUsed: (existing.dailyScrapingUsed || 0) + amount });
	return true;
}

export async function getProfileByNameRow(ctx: any, name: string) {
	const cleaned = String(name || "").trim();
	if (!cleaned) return null;
	const row = await ctx.db
		.query("profiles")
		.withIndex("by_name", (q: any) => q.eq("name", cleaned))
		.first();
	return row ?? null;
}

export async function getAvailableProfilesForLists(ctx: any, listIdsRaw: string[], cooldownMinutesRaw: number) {
	const cleanIds = (listIdsRaw || []).map((v) => String(v || "").trim()).filter(Boolean);
	if (cleanIds.length === 0) return [];
	const cooldownMs = Math.max(0, (Number.isFinite(cooldownMinutesRaw) ? cooldownMinutesRaw : 0) * 60 * 1000);
	const cutoffMs = Date.now() - cooldownMs;
	const allowed = new Set(cleanIds);
	const rows = await ctx.db.query("profiles").collect();
	const filtered = rows.filter((p: any) => {
		const listIds = getProfileListIds(p);
		if (!listIds.some((listId) => allowed.has(String(listId)))) return false;
		if (typeof p.lastOpenedAt !== "number") return true;
		return p.lastOpenedAt < cutoffMs;
	});
	filtered.sort((a: any, b: any) => a.createdAt - b.createdAt);
	return filtered;
}

export async function getProfilesByListIds(ctx: any, listIdsRaw: string[]) {
	const cleanIds = (listIdsRaw || []).map((v) => String(v || "").trim()).filter(Boolean);
	if (cleanIds.length === 0) return [];
	const allowed = new Set(cleanIds);
	const rows = await ctx.db.query("profiles").collect();
	const filtered = rows.filter((p: any) => {
		const listIds = getProfileListIds(p);
		return listIds.some((listId) => allowed.has(String(listId)));
	});
	filtered.sort((a: any, b: any) => a.createdAt - b.createdAt);
	return filtered;
}

export async function createProfileRow(ctx: any, args: any) {
	const name = String(args.name || "").trim();
	if (!name) throw new Error("name is required");
	const proxy = typeof args.proxy === "string" ? args.proxy : undefined;
	const cookiesJsonRaw = typeof args.cookiesJson === "string" ? args.cookiesJson.trim() : "";
	const sessionIdRaw = typeof args.sessionId === "string" ? args.sessionId.trim() : "";
	const dailyLimit = normalizeDailyScrapingLimit(args.dailyScrapingLimit);

	const id = await ctx.db.insert("profiles", {
		createdAt: Date.now(),
		name,
		proxy,
		proxyType: args.proxyType,
		status: "idle",
		mode: computeProfileMode(proxy),
		sessionId: sessionIdRaw ? sessionIdRaw : undefined,
		cookiesJson: cookiesJsonRaw ? cookiesJsonRaw : undefined,
		using: false,
		testIp: args.testIp ?? false,
		fingerprintSeed: args.fingerprintSeed,
		fingerprintOs: args.fingerprintOs,
		listIds: [],
		lastOpenedAt: undefined,
		login: false,
		dailyScrapingLimit: dailyLimit,
		dailyScrapingUsed: 0,
		scrapeLeaseOwner: undefined,
		scrapeLeaseExpiresAt: undefined,
		scrapeHealth: 100,
		lastScrapeFailureAt: undefined,
	});
	return await ctx.db.get(id);
}

export async function updateProfileByNameRow(ctx: any, args: any) {
	const oldClean = String(args.oldName || "").trim();
	if (!oldClean) throw new Error("old_name is required");
	const existing = await ctx.db
		.query("profiles")
		.withIndex("by_name", (q: any) => q.eq("name", oldClean))
		.first();
	if (!existing) throw new Error("Profile not found");

	const name = String(args.name || "").trim();
	if (!name) throw new Error("name is required");

	const next: Record<string, unknown> = { name };

	if (typeof args.proxy === "string") {
		next.proxy = args.proxy;
		next.mode = computeProfileMode(args.proxy);
	}
	if (typeof args.proxyType === "string") {
		next.proxyType = args.proxyType;
	}
	if (typeof args.testIp === "boolean") {
		next.testIp = args.testIp;
	}
	if (typeof args.fingerprintSeed === "string") {
		next.fingerprintSeed = args.fingerprintSeed;
	}
	if (typeof args.fingerprintOs === "string") {
		next.fingerprintOs = args.fingerprintOs;
	}
	if (typeof args.cookiesJson === "string") {
		const cleaned = args.cookiesJson.trim();
		next.cookiesJson = cleaned ? cleaned : undefined;
	}
	if (typeof args.sessionId === "string") {
		const cleaned = args.sessionId.trim();
		next.sessionId = cleaned ? cleaned : undefined;
	}
	if (typeof args.dailyScrapingLimit === "number") {
		next.dailyScrapingLimit = normalizeDailyScrapingLimit(args.dailyScrapingLimit);
	} else if (args.dailyScrapingLimit === null) {
		next.dailyScrapingLimit = undefined;
	}
	await ctx.db.patch(existing._id, {
		...(next as any),
	});
	return await ctx.db.get(existing._id);
}

export async function updateProfileByIdRow(ctx: any, args: any) {
	const name = String(args.name || "").trim();
	if (!name) throw new Error("name is required");
	const existing = await ctx.db.get(args.profileId);
	if (!existing) throw new Error("Profile not found");

	const next: Record<string, unknown> = { name };

	if (typeof args.proxy === "string") {
		next.proxy = args.proxy;
		next.mode = computeProfileMode(args.proxy);
	}
	if (typeof args.proxyType === "string") {
		next.proxyType = args.proxyType;
	}
	if (typeof args.testIp === "boolean") {
		next.testIp = args.testIp;
	}
	if (typeof args.fingerprintSeed === "string") {
		next.fingerprintSeed = args.fingerprintSeed;
	}
	if (typeof args.fingerprintOs === "string") {
		next.fingerprintOs = args.fingerprintOs;
	}
	if (typeof args.cookiesJson === "string") {
		const cleaned = args.cookiesJson.trim();
		next.cookiesJson = cleaned ? cleaned : undefined;
	}
	if (typeof args.sessionId === "string") {
		const cleaned = args.sessionId.trim();
		next.sessionId = cleaned ? cleaned : undefined;
	}
	if (typeof args.dailyScrapingLimit === "number") {
		next.dailyScrapingLimit = normalizeDailyScrapingLimit(args.dailyScrapingLimit);
	} else if (args.dailyScrapingLimit === null) {
		next.dailyScrapingLimit = undefined;
	}
	await ctx.db.patch(args.profileId, {
		...(next as any),
	});
	return await ctx.db.get(args.profileId);
}

export async function removeProfileByNameRow(ctx: any, name: string) {
	const cleaned = String(name || "").trim();
	if (!cleaned) throw new Error("name is required");
	const existing = await ctx.db
		.query("profiles")
		.withIndex("by_name", (q: any) => q.eq("name", cleaned))
		.first();
	if (!existing) return true;
	const accounts = await ctx.db
		.query("instagramAccounts")
		.withIndex("by_assignedTo", (q: any) => q.eq("assignedTo", existing._id))
		.collect();
	await Promise.all(accounts.map((a: any) => ctx.db.patch(a._id, { assignedTo: undefined })));
	await ctx.db.delete(existing._id);
	return true;
}

export async function removeProfileByIdRow(ctx: any, profileId: any) {
	const existing = await ctx.db.get(profileId);
	if (!existing) return true;
	const accounts = await ctx.db
		.query("instagramAccounts")
		.withIndex("by_assignedTo", (q: any) => q.eq("assignedTo", profileId))
		.collect();
	await Promise.all(accounts.map((a: any) => ctx.db.patch(a._id, { assignedTo: undefined })));
	await ctx.db.delete(profileId);
	return true;
}

export async function syncProfileStatusRow(ctx: any, name: string, status: string, using?: boolean) {
	const cleanedName = String(name || "").trim();
	const cleanedStatus = String(status || "").trim();
	if (!cleanedName || !cleanedStatus) throw new Error("name and status are required");
	const existing = await ctx.db
		.query("profiles")
		.withIndex("by_name", (q: any) => q.eq("name", cleanedName))
		.first();
	if (!existing) return true;
	const next: Record<string, unknown> = { status: cleanedStatus, using: Boolean(using) };
	if (cleanedStatus.toLowerCase() === "running") {
		next.lastOpenedAt = Date.now();
	}
	await ctx.db.patch(existing._id, next as any);
	return true;
}

export async function setProfileLoginTrueRow(ctx: any, name: string) {
	const cleanedName = String(name || "").trim();
	if (!cleanedName) throw new Error("name is required");
	const existing = await ctx.db
		.query("profiles")
		.withIndex("by_name", (q: any) => q.eq("name", cleanedName))
		.first();
	if (!existing) return true;
	await ctx.db.patch(existing._id, { login: true });
	return true;
}

export async function listAssignedProfilesRow(ctx: any, listId: any) {
	const rows = await ctx.db.query("profiles").collect();
	const result = rows
		.filter((r: any) => r.login && getProfileListIds(r).some((id) => String(id) === String(listId)))
		.map((r: any) => ({ _id: r._id, name: r.name, createdAt: r.createdAt }))
		.sort((a: any, b: any) => a.createdAt - b.createdAt)
		.map((r: any) => ({ profileId: r._id, name: r.name }));
	return result;
}

export async function listUnassignedProfilesRow(ctx: any) {
	const rows = await ctx.db.query("profiles").collect();
	const result = rows
		.filter((r: any) => r.login && getProfileListIds(r).length === 0)
		.map((r: any) => ({ _id: r._id, name: r.name, createdAt: r.createdAt }))
		.sort((a: any, b: any) => a.createdAt - b.createdAt)
		.map((r: any) => ({ profileId: r._id, name: r.name }));
	return result;
}

export async function bulkSetProfileListIdRow(ctx: any, profileIds: any[], listId: any) {
	if (!Array.isArray(profileIds) || profileIds.length === 0) return true;
	const nextListIds = listId === null || typeof listId === "undefined" ? [] : [listId];
	await Promise.all(profileIds.map((id) => ctx.db.patch(id, buildListPatch(nextListIds))));
	return true;
}

export async function bulkAddProfilesToListRow(ctx: any, profileIds: any[], listId: any) {
	if (!Array.isArray(profileIds) || profileIds.length === 0) return true;
	await Promise.all(
		profileIds.map(async (id) => {
			const row = await ctx.db.get(id);
			if (!row) return;
			const next = getProfileListIds(row);
			if (!next.some((existingListId) => String(existingListId) === String(listId))) {
				next.push(listId);
			}
			await ctx.db.patch(id, buildListPatch(next));
		}),
	);
	return true;
}

export async function bulkRemoveProfilesFromListRow(ctx: any, profileIds: any[], listId: any) {
	if (!Array.isArray(profileIds) || profileIds.length === 0) return true;
	await Promise.all(
		profileIds.map(async (id) => {
			const row = await ctx.db.get(id);
			if (!row) return;
			const next = getProfileListIds(row).filter((existingListId) => String(existingListId) !== String(listId));
			await ctx.db.patch(id, buildListPatch(next));
		}),
	);
	return true;
}

export async function clearBusyProfilesForListsRow(ctx: any, listIds: any[]) {
	if (!Array.isArray(listIds) || listIds.length === 0) return true;
	const allowed = new Set(listIds.map((id) => String(id)));
	const rows = (await ctx.db.query("profiles").collect()).filter((profile: any) =>
		getProfileListIds(profile).some((listId) => allowed.has(String(listId))),
	);
	const toUpdate = rows.filter((r: any) => (String(r.status || "").toLowerCase() === "running" ? true : Boolean(r.using)));
	await Promise.all(toUpdate.map((p: any) => ctx.db.patch(p._id, { status: "idle", using: false })));
	return true;
}

export async function claimBestScrapeLeaseRow(
	ctx: any,
	workerId: string,
	leaseMsRaw: number,
	nowRaw: number,
	minHealthRaw: number
) {
	const worker = String(workerId || "").trim();
	if (!worker) throw new Error("workerId is required");
	const now = Number.isFinite(nowRaw) ? Math.floor(nowRaw) : Date.now();
	const leaseMs = Math.max(1000, Number.isFinite(leaseMsRaw) ? Math.floor(leaseMsRaw) : 90000);
	const minHealth = Math.max(0, Math.min(100, Number.isFinite(minHealthRaw) ? Math.floor(minHealthRaw) : 25));
	const rows = await ctx.db.query("profiles").collect();
	const candidates = rows.filter((profile: any) => {
		const proxy = typeof profile.proxy === "string" ? profile.proxy.trim() : "";
		const sessionId = typeof profile.sessionId === "string" ? profile.sessionId.trim() : "";
		if (!proxy || !sessionId) return false;
		if (Boolean(profile.using) || String(profile.status || "").toLowerCase() === "running") return false;
		if (hasActiveScrapeLease(profile, now)) return false;
		if (!hasRemainingDailyCapacity(profile)) return false;
		return normalizeScrapeHealth(profile.scrapeHealth) >= minHealth;
	});
	candidates.sort((a: any, b: any) => {
		const aOpened = typeof a.lastOpenedAt === "number" ? a.lastOpenedAt : 0;
		const bOpened = typeof b.lastOpenedAt === "number" ? b.lastOpenedAt : 0;
		if (aOpened !== bOpened) return aOpened - bOpened;
		const aUsed = typeof a.dailyScrapingUsed === "number" ? a.dailyScrapingUsed : 0;
		const bUsed = typeof b.dailyScrapingUsed === "number" ? b.dailyScrapingUsed : 0;
		if (aUsed !== bUsed) return aUsed - bUsed;
		return a.createdAt - b.createdAt;
	});

	const selected = candidates[0];
	if (!selected) return null;
	await ctx.db.patch(selected._id, {
		scrapeLeaseOwner: worker,
		scrapeLeaseExpiresAt: now + leaseMs,
		lastOpenedAt: now,
	});
	return await ctx.db.get(selected._id);
}

export async function refreshScrapeLeaseRow(ctx: any, profileId: any, workerId: string, leaseMsRaw: number, nowRaw: number) {
	const existing = await ctx.db.get(profileId);
	if (!existing) throw new Error("Profile not found");
	const worker = String(workerId || "").trim();
	if (!worker) throw new Error("workerId is required");
	if (String(existing.scrapeLeaseOwner || "").trim() !== worker) {
		throw new Error("Profile scrape lease is not owned by this worker");
	}
	const now = Number.isFinite(nowRaw) ? Math.floor(nowRaw) : Date.now();
	const leaseMs = Math.max(1000, Number.isFinite(leaseMsRaw) ? Math.floor(leaseMsRaw) : 90000);
	await ctx.db.patch(profileId, {
		scrapeLeaseExpiresAt: now + leaseMs,
	});
	return await ctx.db.get(profileId);
}

export async function releaseScrapeLeaseRow(ctx: any, profileId: any, workerId?: string | null) {
	const existing = await ctx.db.get(profileId);
	if (!existing) return true;
	const worker = typeof workerId === "string" ? workerId.trim() : "";
	if (worker && String(existing.scrapeLeaseOwner || "").trim() !== worker) {
		return true;
	}
	await ctx.db.patch(profileId, {
		scrapeLeaseOwner: undefined,
		scrapeLeaseExpiresAt: undefined,
	});
	return true;
}

export async function markScrapeSuccessRow(ctx: any, profileId: any, amountRaw: number, workerId: string, nowRaw: number) {
	const existing = await ctx.db.get(profileId);
	if (!existing) throw new Error("Profile not found");
	const worker = String(workerId || "").trim();
	if (worker && String(existing.scrapeLeaseOwner || "").trim() !== worker) {
		throw new Error("Profile scrape lease is not owned by this worker");
	}
	const amount = Number.isFinite(amountRaw) ? Math.max(0, Math.floor(amountRaw)) : 0;
	const now = Number.isFinite(nowRaw) ? Math.floor(nowRaw) : Date.now();
	await ctx.db.patch(profileId, {
		dailyScrapingUsed: (existing.dailyScrapingUsed || 0) + amount,
		scrapeHealth: Math.min(100, normalizeScrapeHealth(existing.scrapeHealth) + 1),
		scrapeLeaseOwner: undefined,
		scrapeLeaseExpiresAt: undefined,
		lastOpenedAt: now,
	});
	return await ctx.db.get(profileId);
}

export async function markScrapeFailureRow(ctx: any, profileId: any, workerId: string, nowRaw: number) {
	const existing = await ctx.db.get(profileId);
	if (!existing) throw new Error("Profile not found");
	const worker = String(workerId || "").trim();
	if (worker && String(existing.scrapeLeaseOwner || "").trim() !== worker) {
		throw new Error("Profile scrape lease is not owned by this worker");
	}
	const now = Number.isFinite(nowRaw) ? Math.floor(nowRaw) : Date.now();
	await ctx.db.patch(profileId, {
		scrapeHealth: Math.max(0, normalizeScrapeHealth(existing.scrapeHealth) - 10),
		lastScrapeFailureAt: now,
		scrapeLeaseOwner: undefined,
		scrapeLeaseExpiresAt: undefined,
	});
	return await ctx.db.get(profileId);
}

export async function sweepExpiredScrapeLeasesRow(ctx: any, nowRaw: number) {
	const now = Number.isFinite(nowRaw) ? Math.floor(nowRaw) : Date.now();
	const rows = await ctx.db.query("profiles").collect();
	const expired = rows.filter((profile: any) => hasActiveScrapeLease(profile, now) === false && Boolean(profile.scrapeLeaseOwner));
	await Promise.all(
		expired.map((profile: any) =>
			ctx.db.patch(profile._id, {
				scrapeLeaseOwner: undefined,
				scrapeLeaseExpiresAt: undefined,
			})
		)
	);
	return { released: expired.length };
}
