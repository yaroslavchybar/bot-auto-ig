import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";

function computeProfileMode(proxy: unknown): "proxy" | "direct" {
	const s = typeof proxy === "string" ? proxy.trim() : "";
	return s ? "proxy" : "direct";
}

export const list = query({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query("profiles").collect();
		rows.sort((a, b) => a.createdAt - b.createdAt);
		return rows;
	},
});

export const getByName = query({
	args: { name: v.string() },
	handler: async (ctx, args) => {
		const cleaned = String(args.name || "").trim();
		if (!cleaned) return null;
		const row = await ctx.db
			.query("profiles")
			.withIndex("by_name", (q) => q.eq("name", cleaned))
			.first();
		return row ?? null;
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
		maxSessions: v.number(),
		cooldownMinutes: v.number(),
	},
	handler: async (ctx, args) => {
		const cleanIds = (args.listIds || []).map((v) => String(v || "").trim()).filter(Boolean);
		if (cleanIds.length === 0) return [];
		const maxSessions = Number.isFinite(args.maxSessions) ? args.maxSessions : 0;
		const cooldownMs = Math.max(0, (Number.isFinite(args.cooldownMinutes) ? args.cooldownMinutes : 0) * 60 * 1000);
		const cutoffMs = Date.now() - cooldownMs;
		const allowed = new Set(cleanIds);
		const rows = await ctx.db.query("profiles").collect();
		const filtered = rows.filter((p) => {
			if (!p.listId) return false;
			if (!allowed.has(String(p.listId))) return false;
			if ((p.sessionsToday || 0) >= maxSessions) return false;
			if (typeof p.lastOpenedAt !== "number") return true;
			return p.lastOpenedAt < cutoffMs;
		});
		filtered.sort((a, b) => a.createdAt - b.createdAt);
		return filtered;
	},
});

export const getByListIds = query({
	args: {
		listIds: v.array(v.string()),
	},
	handler: async (ctx, args) => {
		const cleanIds = (args.listIds || []).map((v) => String(v || "").trim()).filter(Boolean);
		if (cleanIds.length === 0) return [];
		const allowed = new Set(cleanIds);
		const rows = await ctx.db.query("profiles").collect();
		const filtered = rows.filter((p) => {
			if (!p.listId) return false;
			return allowed.has(String(p.listId));
		});
		filtered.sort((a, b) => a.createdAt - b.createdAt);
		return filtered;
	},
});

export const create = mutation({
	args: {
		name: v.string(),
		proxy: v.optional(v.string()),
		proxyType: v.optional(v.string()),
		testIp: v.optional(v.boolean()),
		fingerprint: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const name = String(args.name || "").trim();
		if (!name) throw new Error("name is required");
		const proxy = typeof args.proxy === "string" ? args.proxy : undefined;
		const id = await ctx.db.insert("profiles", {
			createdAt: Date.now(),
			name,
			proxy,
			proxyType: args.proxyType,
			status: "idle",
			mode: computeProfileMode(proxy),
			using: false,
			testIp: args.testIp ?? false,
			fingerprint: args.fingerprint,
			listId: undefined,
			sessionsToday: 0,
			lastOpenedAt: undefined,
			login: false,
		});
		return await ctx.db.get(id);
	},
});

export const updateByName = mutation({
	args: {
		oldName: v.string(),
		name: v.string(),
		proxy: v.optional(v.string()),
		proxyType: v.optional(v.string()),
		testIp: v.optional(v.boolean()),
		fingerprint: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const oldClean = String(args.oldName || "").trim();
		if (!oldClean) throw new Error("old_name is required");
		const existing = await ctx.db
			.query("profiles")
			.withIndex("by_name", (q) => q.eq("name", oldClean))
			.first();
		if (!existing) throw new Error("Profile not found");

		const name = String(args.name || "").trim();
		if (!name) throw new Error("name is required");
		const proxy = typeof args.proxy === "string" ? args.proxy : undefined;
		await ctx.db.patch(existing._id, {
			name,
			proxy,
			proxyType: args.proxyType,
			testIp: args.testIp ?? false,
			fingerprint: args.fingerprint,
			mode: computeProfileMode(proxy),
		});
		return await ctx.db.get(existing._id);
	},
});

export const updateById = mutation({
	args: {
		profileId: v.id("profiles"),
		name: v.string(),
		proxy: v.optional(v.string()),
		proxyType: v.optional(v.string()),
		testIp: v.optional(v.boolean()),
		fingerprint: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const name = String(args.name || "").trim();
		if (!name) throw new Error("name is required");
		const existing = await ctx.db.get(args.profileId);
		if (!existing) throw new Error("Profile not found");
		const proxy = typeof args.proxy === "string" ? args.proxy : undefined;
		await ctx.db.patch(args.profileId, {
			name,
			proxy,
			proxyType: args.proxyType,
			testIp: args.testIp ?? false,
			fingerprint: args.fingerprint,
			mode: computeProfileMode(proxy),
		});
		return await ctx.db.get(args.profileId);
	},
});

export const removeByName = mutation({
	args: { name: v.string() },
	handler: async (ctx, args) => {
		const cleaned = String(args.name || "").trim();
		if (!cleaned) throw new Error("name is required");
		const existing = await ctx.db
			.query("profiles")
			.withIndex("by_name", (q) => q.eq("name", cleaned))
			.first();
		if (!existing) return true;
		const accounts = await ctx.db
			.query("instagramAccounts")
			.withIndex("by_assignedTo", (q) => q.eq("assignedTo", existing._id))
			.collect();
		await Promise.all(accounts.map((a) => ctx.db.patch(a._id, { assignedTo: undefined })));
		await ctx.db.delete(existing._id);
		return true;
	},
});

export const removeById = mutation({
	args: { profileId: v.id("profiles") },
	handler: async (ctx, args) => {
		const existing = await ctx.db.get(args.profileId);
		if (!existing) return true;
		const accounts = await ctx.db
			.query("instagramAccounts")
			.withIndex("by_assignedTo", (q) => q.eq("assignedTo", args.profileId))
			.collect();
		await Promise.all(accounts.map((a) => ctx.db.patch(a._id, { assignedTo: undefined })));
		await ctx.db.delete(args.profileId);
		return true;
	},
});

export const syncStatus = mutation({
	args: { name: v.string(), status: v.string(), using: v.optional(v.boolean()) },
	handler: async (ctx, args) => {
		const cleanedName = String(args.name || "").trim();
		const cleanedStatus = String(args.status || "").trim();
		if (!cleanedName || !cleanedStatus) throw new Error("name and status are required");
		const existing = await ctx.db
			.query("profiles")
			.withIndex("by_name", (q) => q.eq("name", cleanedName))
			.first();
		if (!existing) return true;
		const next: Record<string, unknown> = { status: cleanedStatus, using: Boolean(args.using) };
		if (cleanedStatus.toLowerCase() === "running") {
			next.lastOpenedAt = Date.now();
		}
		await ctx.db.patch(existing._id, next as any);
		return true;
	},
});

export const setLoginTrue = mutation({
	args: { name: v.string() },
	handler: async (ctx, args) => {
		const cleanedName = String(args.name || "").trim();
		if (!cleanedName) throw new Error("name is required");
		const existing = await ctx.db
			.query("profiles")
			.withIndex("by_name", (q) => q.eq("name", cleanedName))
			.first();
		if (!existing) return true;
		await ctx.db.patch(existing._id, { login: true });
		return true;
	},
});

export const listAssigned = query({
	args: { listId: v.id("lists") },
	handler: async (ctx, args) => {
		const rows = await ctx.db
			.query("profiles")
			.withIndex("by_listId", (q) => q.eq("listId", args.listId))
			.collect();
		const result = rows
			.filter((r) => r.login)
			.map((r) => ({ _id: r._id, name: r.name, createdAt: r.createdAt }))
			.sort((a, b) => a.createdAt - b.createdAt)
			.map((r) => ({ profileId: r._id, name: r.name }));
		return result;
	},
});

export const listUnassigned = query({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query("profiles").collect();
		const result = rows
			.filter((r) => r.login && !r.listId)
			.map((r) => ({ _id: r._id, name: r.name, createdAt: r.createdAt }))
			.sort((a, b) => a.createdAt - b.createdAt)
			.map((r) => ({ profileId: r._id, name: r.name }));
		return result;
	},
});

export const bulkSetListId = mutation({
	args: { profileIds: v.array(v.id("profiles")), listId: v.union(v.null(), v.id("lists")) },
	handler: async (ctx, args) => {
		if (!Array.isArray(args.profileIds) || args.profileIds.length === 0) return true;
		await Promise.all(
			args.profileIds.map((id) => ctx.db.patch(id, { listId: args.listId === null ? undefined : args.listId })),
		);
		return true;
	},
});

export const clearBusyForLists = mutation({
	args: { listIds: v.array(v.id("lists")) },
	handler: async (ctx, args) => {
		if (!Array.isArray(args.listIds) || args.listIds.length === 0) return true;
		const listIds = args.listIds;
		const rows = (
			await Promise.all(
				listIds.map((listId) =>
					ctx.db
						.query("profiles")
						.withIndex("by_listId", (q) => q.eq("listId", listId))
						.collect(),
				),
			)
		).flat();
		const toUpdate = rows.filter((r) => (String(r.status || "").toLowerCase() === "running" ? true : Boolean(r.using)));
		await Promise.all(toUpdate.map((p) => ctx.db.patch(p._id, { status: "idle", using: false })));
		return true;
	},
});

export const incrementSessionsToday = mutation({
	args: { name: v.string() },
	handler: async (ctx, args) => {
		const cleanedName = String(args.name || "").trim();
		if (!cleanedName) throw new Error("name is required");
		const existing = await ctx.db
			.query("profiles")
			.withIndex("by_name", (q) => q.eq("name", cleanedName))
			.first();
		if (!existing) return true;
		await ctx.db.patch(existing._id, { sessionsToday: (existing.sessionsToday || 0) + 1 });
		return true;
	},
});

export const resetSessionsToday = internalMutation({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query("profiles").collect();
		const toUpdate = rows.filter((r) => (r.sessionsToday || 0) !== 0);
		await Promise.all(toUpdate.map((p) => ctx.db.patch(p._id, { sessionsToday: 0 })));
		return true;
	},
});
