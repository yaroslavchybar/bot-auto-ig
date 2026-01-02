import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";

function normalizeUserName(userName: string): string {
	let normalized = String(userName || "").trim();
	if (normalized.startsWith("@")) normalized = normalized.slice(1);
	normalized = normalized.replace(/\/+$/, "");
	return normalized.trim();
}

export const getForProfile = query({
	args: { profileId: v.id("profiles"), status: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const status = String(args.status || "assigned").trim() || "assigned";
		const rows = await ctx.db
			.query("instagramAccounts")
			.withIndex("by_assignedTo_status", (q) => q.eq("assignedTo", args.profileId).eq("status", status))
			.collect();
		rows.sort((a, b) => a.createdAt - b.createdAt);
		return rows;
	},
});

export const getToMessage = query({
	args: { profileId: v.id("profiles") },
	handler: async (ctx, args) => {
		const rows = await ctx.db
			.query("instagramAccounts")
			.withIndex("by_assignedTo", (q) => q.eq("assignedTo", args.profileId))
			.collect();
		const filtered = rows.filter(
			(r) => r.message === true && (r.linkSent === "not send" || r.linkSent === "needed to send"),
		);
		filtered.sort((a, b) => a.createdAt - b.createdAt);
		return filtered;
	},
});

export const updateStatus = mutation({
	args: {
		accountId: v.id("instagramAccounts"),
		status: v.string(),
		assignedTo: v.optional(v.union(v.null(), v.id("profiles"))),
	},
	handler: async (ctx, args) => {
		const status = String(args.status || "").trim();
		if (!status) throw new Error("status is required");
		const patch: Record<string, unknown> = { status };
		if (status.toLowerCase() === "subscribed") {
			patch.subscribedAt = Date.now();
		}
		if (typeof args.assignedTo !== "undefined") {
			patch.assignedTo = args.assignedTo === null ? undefined : args.assignedTo;
		} else if (status.toLowerCase() === "done") {
			patch.assignedTo = undefined;
		}
		await ctx.db.patch(args.accountId, patch as any);
		return await ctx.db.get(args.accountId);
	},
});

export const updateMessage = mutation({
	args: { userName: v.string(), message: v.optional(v.boolean()) },
	handler: async (ctx, args) => {
		const normalized = normalizeUserName(args.userName);
		if (!normalized) return null;
		const rows = await ctx.db.query("instagramAccounts").collect();
		const lower = normalized.toLowerCase();
		const existing =
			rows.find((r) => r.userName === normalized) ?? rows.find((r) => String(r.userName || "").toLowerCase() === lower);
		if (!existing) return null;
		await ctx.db.patch(existing._id, { message: args.message ?? true });
		return await ctx.db.get(existing._id);
	},
});

export const updateLinkSent = mutation({
	args: { userName: v.string(), linkSent: v.string() },
	handler: async (ctx, args) => {
		const normalized = normalizeUserName(args.userName);
		if (!normalized) return null;
		const rows = await ctx.db.query("instagramAccounts").collect();
		const lower = normalized.toLowerCase();
		const existing =
			rows.find((r) => r.userName === normalized) ?? rows.find((r) => String(r.userName || "").toLowerCase() === lower);
		if (!existing) return null;
		await ctx.db.patch(existing._id, { linkSent: args.linkSent });
		return await ctx.db.get(existing._id);
	},
});

export const setLastMessageSentNow = mutation({
	args: { accountId: v.id("instagramAccounts") },
	handler: async (ctx, args) => {
		await ctx.db.patch(args.accountId, { lastMessageSentAt: Date.now() });
		return await ctx.db.get(args.accountId);
	},
});

export const getLastMessageSentAt = query({
	args: { accountId: v.id("instagramAccounts") },
	handler: async (ctx, args) => {
		const row = await ctx.db.get(args.accountId);
		if (!row) return null;
		return typeof row.lastMessageSentAt === "number" ? row.lastMessageSentAt : null;
	},
});

export const listUserNames = query({
	args: { limit: v.number() },
	handler: async (ctx, args) => {
		const limit = Math.max(0, Math.min(10000, Math.floor(args.limit || 0)));
		const rows = await ctx.db.query("instagramAccounts").collect();
		rows.sort((a, b) => a.createdAt - b.createdAt);
		const usernames: string[] = [];
		for (const row of rows) {
			const normalized = normalizeUserName(row.userName);
			if (normalized) usernames.push(normalized);
			if (usernames.length >= limit) break;
		}
		return usernames;
	},
});

export const getProfilesWithAssignedAccounts = query({
	args: { status: v.optional(v.union(v.null(), v.string())) },
	handler: async (ctx, args) => {
		const status = typeof args.status === "string" ? args.status : null;
		const rows = await ctx.db.query("instagramAccounts").collect();
		const profileIds = new Set<string>();
		for (const row of rows) {
			if (!row.assignedTo) continue;
			if (status !== null && row.status !== status) continue;
			profileIds.add(row.assignedTo);
		}
		const profiles = await Promise.all(Array.from(profileIds).map((id) => ctx.db.get(id as any)));
		return profiles.filter(Boolean);
	},
});

export const _autoUnsubscribeApply = internalMutation({
	args: { cutoffMs: v.number() },
	handler: async (ctx, args) => {
		const rows = await ctx.db.query("instagramAccounts").collect();
		const toUpdate = rows.filter(
			(r) => String(r.status || "").toLowerCase() === "subscribed" && typeof r.subscribedAt === "number" && r.subscribedAt <= args.cutoffMs,
		);
		await Promise.all(toUpdate.map((a) => ctx.db.patch(a._id, { status: "unsubscribed" })));
		return true;
	},
});

export const autoUnsubscribe = internalAction({
	args: {},
	handler: async (ctx) => {
		const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
		await ctx.runMutation(internal.instagramAccounts._autoUnsubscribeApply, { cutoffMs });
		return true;
	},
});

export const _listProfileIds = internalQuery({
	args: {},
	handler: async (ctx) => {
		const profiles = await ctx.db.query("profiles").collect();
		return profiles.map((p) => p._id);
	},
});

export const _listAvailableAccountIds = internalQuery({
	args: { max: v.number() },
	handler: async (ctx, args) => {
		const rows = await ctx.db.query("instagramAccounts").collect();
		const available = rows.filter((r) => String(r.status || "").toLowerCase() === "available" && !r.assignedTo);
		available.sort((a, b) => a.createdAt - b.createdAt);
		return available.slice(0, Math.max(0, args.max)).map((r) => r._id);
	},
});

export const _bulkAssignAccounts = internalMutation({
	args: { profileId: v.id("profiles"), accountIds: v.array(v.id("instagramAccounts")) },
	handler: async (ctx, args) => {
		await Promise.all(args.accountIds.map((id) => ctx.db.patch(id, { assignedTo: args.profileId, status: "assigned" })));
		return true;
	},
});

export const assignAvailableAccountsDaily = internalAction({
	args: {},
	handler: async (ctx) => {
		const profileIds = await ctx.runQuery(internal.instagramAccounts._listProfileIds, {});
		for (const profileId of profileIds) {
			const assignCount = 30 + Math.floor(Math.random() * 11);
			const available = await ctx.runQuery(internal.instagramAccounts._listAvailableAccountIds, { max: Math.max(assignCount * 10, 200) });
			if (available.length === 0) continue;
			for (let i = available.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[available[i], available[j]] = [available[j], available[i]];
			}
			const selected = available.slice(0, assignCount);
			if (selected.length === 0) continue;
			await ctx.runMutation(internal.instagramAccounts._bulkAssignAccounts, { profileId, accountIds: selected });
		}
		return true;
	},
});
