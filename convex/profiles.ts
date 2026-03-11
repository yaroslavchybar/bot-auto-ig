import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { mutation, query } from "./auth";

function computeProfileMode(proxy: unknown): "proxy" | "direct" {
	const s = typeof proxy === "string" ? proxy.trim() : "";
	return s ? "proxy" : "direct";
}

function getProfileListIds(profile: any): any[] {
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

function buildListPatch(listIds: any[]): { listIds: any[] } {
	return {
		listIds,
	};
}

function normalizeDailyScrapingLimit(limit: unknown): number | undefined {
	if (limit === null || typeof limit === "undefined") return undefined;
	const numeric = Number(limit);
	if (!Number.isFinite(numeric)) return undefined;
	return Math.max(0, Math.floor(numeric));
}

async function listProfileRows(ctx: any) {
	const rows = await ctx.db.query("profiles").collect();
	rows.sort((a: any, b: any) => a.createdAt - b.createdAt);
	return rows;
}

async function incrementDailyScrapingUsedByName(ctx: any, name: string, amountRaw: number) {
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

async function getProfileByNameRow(ctx: any, name: string) {
	const cleaned = String(name || "").trim();
	if (!cleaned) return null;
	const row = await ctx.db
		.query("profiles")
		.withIndex("by_name", (q: any) => q.eq("name", cleaned))
		.first();
	return row ?? null;
}

async function getAvailableProfilesForLists(ctx: any, listIdsRaw: string[], cooldownMinutesRaw: number) {
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

async function getProfilesByListIds(ctx: any, listIdsRaw: string[]) {
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

async function createProfileRow(ctx: any, args: any) {
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
	});
	return await ctx.db.get(id);
}

async function updateProfileByNameRow(ctx: any, args: any) {
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

async function updateProfileByIdRow(ctx: any, args: any) {
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

async function removeProfileByNameRow(ctx: any, name: string) {
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

async function removeProfileByIdRow(ctx: any, profileId: any) {
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

async function syncProfileStatusRow(ctx: any, name: string, status: string, using?: boolean) {
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

async function setProfileLoginTrueRow(ctx: any, name: string) {
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

async function listAssignedProfilesRow(ctx: any, listId: any) {
	const rows = await ctx.db.query("profiles").collect();
	const result = rows
		.filter((r: any) => r.login && getProfileListIds(r).some((id) => String(id) === String(listId)))
		.map((r: any) => ({ _id: r._id, name: r.name, createdAt: r.createdAt }))
		.sort((a: any, b: any) => a.createdAt - b.createdAt)
		.map((r: any) => ({ profileId: r._id, name: r.name }));
	return result;
}

async function listUnassignedProfilesRow(ctx: any) {
	const rows = await ctx.db.query("profiles").collect();
	const result = rows
		.filter((r: any) => r.login && getProfileListIds(r).length === 0)
		.map((r: any) => ({ _id: r._id, name: r.name, createdAt: r.createdAt }))
		.sort((a: any, b: any) => a.createdAt - b.createdAt)
		.map((r: any) => ({ profileId: r._id, name: r.name }));
	return result;
}

async function bulkSetProfileListIdRow(ctx: any, profileIds: any[], listId: any) {
	if (!Array.isArray(profileIds) || profileIds.length === 0) return true;
	const nextListIds = listId === null || typeof listId === "undefined" ? [] : [listId];
	await Promise.all(profileIds.map((id) => ctx.db.patch(id, buildListPatch(nextListIds))));
	return true;
}

async function bulkAddProfilesToListRow(ctx: any, profileIds: any[], listId: any) {
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

async function bulkRemoveProfilesFromListRow(ctx: any, profileIds: any[], listId: any) {
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

async function clearBusyProfilesForListsRow(ctx: any, listIds: any[]) {
	if (!Array.isArray(listIds) || listIds.length === 0) return true;
	const allowed = new Set(listIds.map((id) => String(id)));
	const rows = (await ctx.db.query("profiles").collect()).filter((profile: any) =>
		getProfileListIds(profile).some((listId) => allowed.has(String(listId))),
	);
	const toUpdate = rows.filter((r: any) => (String(r.status || "").toLowerCase() === "running" ? true : Boolean(r.using)));
	await Promise.all(toUpdate.map((p: any) => ctx.db.patch(p._id, { status: "idle", using: false })));
	return true;
}

export const listInternal = internalQuery({
	args: {},
	handler: async (ctx) => {
		return await listProfileRows(ctx);
	},
});

export const getByIdInternal = internalQuery({
	args: { profileId: v.id("profiles") },
	handler: async (ctx, args) => {
		return (await ctx.db.get(args.profileId)) ?? null;
	},
});

export const list = query({
	args: {},
	handler: async (ctx) => {
		return await listProfileRows(ctx);
	},
});

export const getByName = query({
	args: { name: v.string() },
	handler: async (ctx, args) => {
		return await getProfileByNameRow(ctx, args.name);
	},
});

export const getByNameInternal = internalQuery({
	args: { name: v.string() },
	handler: async (ctx, args) => {
		return await getProfileByNameRow(ctx, args.name);
	},
});

export const getById = query({
	args: { profileId: v.id("profiles") },
	handler: async (ctx, args) => {
		return (await ctx.db.get(args.profileId)) ?? null;
	},
});

export const getAvailableForLists = query({
	args: {
		listIds: v.array(v.string()),
		cooldownMinutes: v.number(),
	},
	handler: async (ctx, args) => {
		return await getAvailableProfilesForLists(ctx, args.listIds, args.cooldownMinutes);
	},
});

export const getAvailableForListsInternal = internalQuery({
	args: {
		listIds: v.array(v.string()),
		cooldownMinutes: v.number(),
	},
	handler: async (ctx, args) => {
		return await getAvailableProfilesForLists(ctx, args.listIds, args.cooldownMinutes);
	},
});

export const getByListIds = query({
	args: {
		listIds: v.array(v.string()),
	},
	handler: async (ctx, args) => {
		return await getProfilesByListIds(ctx, args.listIds);
	},
});

export const getByListIdsInternal = internalQuery({
	args: {
		listIds: v.array(v.string()),
	},
	handler: async (ctx, args) => {
		return await getProfilesByListIds(ctx, args.listIds);
	},
});

export const create = mutation({
	args: {
		name: v.string(),
		proxy: v.optional(v.string()),
		proxyType: v.optional(v.string()),
		testIp: v.optional(v.boolean()),
		fingerprintSeed: v.optional(v.string()),
		fingerprintOs: v.optional(v.string()),
		cookiesJson: v.optional(v.string()),
		sessionId: v.optional(v.string()),
		dailyScrapingLimit: v.optional(v.union(v.number(), v.null())),
	},
	handler: async (ctx, args) => {
		return await createProfileRow(ctx, args);
	},
});

export const createInternal = internalMutation({
	args: {
		name: v.string(),
		proxy: v.optional(v.string()),
		proxyType: v.optional(v.string()),
		testIp: v.optional(v.boolean()),
		fingerprintSeed: v.optional(v.string()),
		fingerprintOs: v.optional(v.string()),
		cookiesJson: v.optional(v.string()),
		sessionId: v.optional(v.string()),
		dailyScrapingLimit: v.optional(v.union(v.number(), v.null())),
	},
	handler: async (ctx, args) => {
		return await createProfileRow(ctx, args);
	},
});

export const updateByName = mutation({
	args: {
		oldName: v.string(),
		name: v.string(),
		proxy: v.optional(v.string()),
		proxyType: v.optional(v.string()),
		testIp: v.optional(v.boolean()),
		fingerprintSeed: v.optional(v.string()),
		fingerprintOs: v.optional(v.string()),
		cookiesJson: v.optional(v.string()),
		sessionId: v.optional(v.string()),
		dailyScrapingLimit: v.optional(v.union(v.number(), v.null())),
	},
	handler: async (ctx, args) => {
		return await updateProfileByNameRow(ctx, args);
	},
});

export const updateByNameInternal = internalMutation({
	args: {
		oldName: v.string(),
		name: v.string(),
		proxy: v.optional(v.string()),
		proxyType: v.optional(v.string()),
		testIp: v.optional(v.boolean()),
		fingerprintSeed: v.optional(v.string()),
		fingerprintOs: v.optional(v.string()),
		cookiesJson: v.optional(v.string()),
		sessionId: v.optional(v.string()),
		dailyScrapingLimit: v.optional(v.union(v.number(), v.null())),
	},
	handler: async (ctx, args) => {
		return await updateProfileByNameRow(ctx, args);
	},
});

export const updateById = mutation({
	args: {
		profileId: v.id("profiles"),
		name: v.string(),
		proxy: v.optional(v.string()),
		proxyType: v.optional(v.string()),
		testIp: v.optional(v.boolean()),
		fingerprintSeed: v.optional(v.string()),
		fingerprintOs: v.optional(v.string()),
		cookiesJson: v.optional(v.string()),
		sessionId: v.optional(v.string()),
		dailyScrapingLimit: v.optional(v.union(v.number(), v.null())),
	},
	handler: async (ctx, args) => {
		return await updateProfileByIdRow(ctx, args);
	},
});

export const updateByIdInternal = internalMutation({
	args: {
		profileId: v.id("profiles"),
		name: v.string(),
		proxy: v.optional(v.string()),
		proxyType: v.optional(v.string()),
		testIp: v.optional(v.boolean()),
		fingerprintSeed: v.optional(v.string()),
		fingerprintOs: v.optional(v.string()),
		cookiesJson: v.optional(v.string()),
		sessionId: v.optional(v.string()),
		dailyScrapingLimit: v.optional(v.union(v.number(), v.null())),
	},
	handler: async (ctx, args) => {
		return await updateProfileByIdRow(ctx, args);
	},
});

export const removeByName = mutation({
	args: { name: v.string() },
	handler: async (ctx, args) => {
		return await removeProfileByNameRow(ctx, args.name);
	},
});

export const removeByNameInternal = internalMutation({
	args: { name: v.string() },
	handler: async (ctx, args) => {
		return await removeProfileByNameRow(ctx, args.name);
	},
});

export const removeById = mutation({
	args: { profileId: v.id("profiles") },
	handler: async (ctx, args) => {
		return await removeProfileByIdRow(ctx, args.profileId);
	},
});

export const removeByIdInternal = internalMutation({
	args: { profileId: v.id("profiles") },
	handler: async (ctx, args) => {
		return await removeProfileByIdRow(ctx, args.profileId);
	},
});

export const syncStatus = mutation({
	args: { name: v.string(), status: v.string(), using: v.optional(v.boolean()) },
	handler: async (ctx, args) => {
		return await syncProfileStatusRow(ctx, args.name, args.status, args.using);
	},
});

export const syncStatusInternal = internalMutation({
	args: { name: v.string(), status: v.string(), using: v.optional(v.boolean()) },
	handler: async (ctx, args) => {
		return await syncProfileStatusRow(ctx, args.name, args.status, args.using);
	},
});

export const setLoginTrue = mutation({
	args: { name: v.string() },
	handler: async (ctx, args) => {
		return await setProfileLoginTrueRow(ctx, args.name);
	},
});

export const setLoginTrueInternal = internalMutation({
	args: { name: v.string() },
	handler: async (ctx, args) => {
		return await setProfileLoginTrueRow(ctx, args.name);
	},
});

export const listAssigned = query({
	args: { listId: v.id("lists") },
	handler: async (ctx, args) => {
		return await listAssignedProfilesRow(ctx, args.listId);
	},
});

export const listAssignedInternal = internalQuery({
	args: { listId: v.id("lists") },
	handler: async (ctx, args) => {
		return await listAssignedProfilesRow(ctx, args.listId);
	},
});

export const listUnassigned = query({
	args: {},
	handler: async (ctx) => {
		return await listUnassignedProfilesRow(ctx);
	},
});

export const listUnassignedInternal = internalQuery({
	args: {},
	handler: async (ctx) => {
		return await listUnassignedProfilesRow(ctx);
	},
});

export const bulkSetListId = mutation({
	args: { profileIds: v.array(v.id("profiles")), listId: v.optional(v.union(v.null(), v.id("lists"))) },
	handler: async (ctx, args) => {
		return await bulkSetProfileListIdRow(ctx, args.profileIds, args.listId);
	},
});

export const bulkSetListIdInternal = internalMutation({
	args: { profileIds: v.array(v.id("profiles")), listId: v.optional(v.union(v.null(), v.id("lists"))) },
	handler: async (ctx, args) => {
		return await bulkSetProfileListIdRow(ctx, args.profileIds, args.listId);
	},
});

export const bulkAddToList = mutation({
	args: { profileIds: v.array(v.id("profiles")), listId: v.id("lists") },
	handler: async (ctx, args) => {
		return await bulkAddProfilesToListRow(ctx, args.profileIds, args.listId);
	},
});

export const bulkAddToListInternal = internalMutation({
	args: { profileIds: v.array(v.id("profiles")), listId: v.id("lists") },
	handler: async (ctx, args) => {
		return await bulkAddProfilesToListRow(ctx, args.profileIds, args.listId);
	},
});

export const bulkRemoveFromList = mutation({
	args: { profileIds: v.array(v.id("profiles")), listId: v.id("lists") },
	handler: async (ctx, args) => {
		return await bulkRemoveProfilesFromListRow(ctx, args.profileIds, args.listId);
	},
});

export const bulkRemoveFromListInternal = internalMutation({
	args: { profileIds: v.array(v.id("profiles")), listId: v.id("lists") },
	handler: async (ctx, args) => {
		return await bulkRemoveProfilesFromListRow(ctx, args.profileIds, args.listId);
	},
});

export const clearBusyForLists = mutation({
	args: { listIds: v.array(v.id("lists")) },
	handler: async (ctx, args) => {
		return await clearBusyProfilesForListsRow(ctx, args.listIds);
	},
});

export const clearBusyForListsInternal = internalMutation({
	args: { listIds: v.array(v.id("lists")) },
	handler: async (ctx, args) => {
		return await clearBusyProfilesForListsRow(ctx, args.listIds);
	},
});

export const incrementDailyScrapingUsed = mutation({
	args: { name: v.string(), amount: v.number() },
	handler: async (ctx, args) => {
		return await incrementDailyScrapingUsedByName(ctx, args.name, args.amount);
	},
});

export const incrementDailyScrapingUsedInternal = internalMutation({
	args: { name: v.string(), amount: v.number() },
	handler: async (ctx, args) => {
		return await incrementDailyScrapingUsedByName(ctx, args.name, args.amount);
	},
});

export const incrementDailyScrapingUsedById = mutation({
	args: { profileId: v.id("profiles"), amount: v.number() },
	handler: async (ctx, args) => {
		const amount = Number.isFinite(args.amount) ? Math.max(0, Math.floor(args.amount)) : 0;
		if (amount === 0) return true;
		const existing = await ctx.db.get(args.profileId);
		if (!existing) return true;
		await ctx.db.patch(existing._id, { dailyScrapingUsed: (existing.dailyScrapingUsed || 0) + amount });
		return true;
	},
});

export const updateDailyScrapingLimit = mutation({
	args: { profileId: v.id("profiles"), limit: v.union(v.number(), v.null()) },
	handler: async (ctx, args) => {
		const existing = await ctx.db.get(args.profileId);
		if (!existing) throw new Error("Profile not found");
		const limit = normalizeDailyScrapingLimit(args.limit);
		await ctx.db.patch(args.profileId, { dailyScrapingLimit: limit });
		return await ctx.db.get(args.profileId);
	},
});

export const resetDailyScrapingUsed = internalMutation({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query("profiles").collect();
		const toUpdate = rows.filter((r) => (r.dailyScrapingUsed || 0) !== 0);
		await Promise.all(toUpdate.map((p) => ctx.db.patch(p._id, { dailyScrapingUsed: 0 })));
		return true;
	},
});

export const migrateLegacyListIdToListIds = internalMutation({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query("profiles").collect();
		let migrated = 0;
		for (const row of rows) {
			const doc = row as any;
			if (Array.isArray(doc.listIds)) continue;
			const legacyListId = doc.listId;
			const listIds = legacyListId ? [legacyListId] : [];
			await ctx.db.patch(row._id, { listIds } as any);
			migrated++;
		}
		return { migrated };
	},
});

export const cleanupLegacyListIdField = internalMutation({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query("profiles").collect();
		let cleaned = 0;
		for (const row of rows) {
			const doc = row as any;
			if (!("listId" in doc)) continue;
			await ctx.db.patch(row._id, { listId: undefined } as any);
			cleaned++;
		}
		return { cleaned };
	},
});

// Migration completed - can be deleted
export const migrateRemoveSessionsToday = internalMutation({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query("profiles").collect();
		let migrated = 0;
		for (const row of rows) {
			const doc = row as any;
			if ("sessionsToday" in doc) {
				await ctx.db.patch(row._id, { sessionsToday: undefined } as any);
				migrated++;
			}
		}
		return { migrated };
	},
});
