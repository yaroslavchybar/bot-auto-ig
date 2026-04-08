import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { normalizeAssignedAccountsLimit } from "./profiles/helpers";

function normalizeUserName(userName: string): string {
	let normalized = String(userName || "").trim();
	if (normalized.startsWith("@")) normalized = normalized.slice(1);
	normalized = normalized.replace(/\/+$/, "");
	return normalized.trim().toLowerCase();
}

export const insert = internalMutation({
	args: {
		userName: v.string(),
		fullName: v.optional(v.string()),
		matchedName: v.optional(v.string()),
		status: v.union(
			v.literal("available"),
			v.literal("assigned"),
			v.literal("subscribed"),
			v.literal("unsubscribed"),
			v.literal("skipped"),
			v.literal("done"),
		),
		message: v.boolean(),
		createdAt: v.number(),
	},
	handler: async (ctx, args) => {
		const userName = normalizeUserName(args.userName);
		if (!userName) throw new Error("userName is required");
		const existing = await ctx.db
			.query("instagramAccounts")
			.withIndex("by_userName", (q) => q.eq("userName", userName))
			.first();
		if (existing) {
			return { id: existing._id, alreadyExisted: true };
		}
		const id = await ctx.db.insert("instagramAccounts", {
			userName,
			fullName: args.fullName,
			matchedName: args.matchedName,
			status: args.status,
			message: args.message,
			createdAt: args.createdAt,
		});
		return { id, alreadyExisted: false };
	},
});

export const insertBatch = internalMutation({
	args: {
		accounts: v.array(
			v.object({
				userName: v.string(),
				fullName: v.optional(v.string()),
				matchedName: v.optional(v.string()),
				status: v.union(
					v.literal("available"),
					v.literal("assigned"),
					v.literal("subscribed"),
					v.literal("unsubscribed"),
					v.literal("skipped"),
					v.literal("done"),
				),
				message: v.boolean(),
				createdAt: v.number(),
			}),
		),
	},
	handler: async (ctx, { accounts }) => {
		const insertedIds = [];
		const seen = new Set<string>();
		let skipped = 0;
		for (const account of accounts) {
			const userName = normalizeUserName(account.userName);
			if (!userName) throw new Error("userName is required");
			if (seen.has(userName)) {
				skipped++;
				continue;
			}
			seen.add(userName);
			const existing = await ctx.db
				.query("instagramAccounts")
				.withIndex("by_userName", (q) => q.eq("userName", userName))
				.first();
			if (existing) {
				skipped++;
				continue;
			}
			const id = await ctx.db.insert("instagramAccounts", {
				userName,
				fullName: account.fullName,
				matchedName: account.matchedName,
				status: account.status,
				message: account.message,
				createdAt: account.createdAt,
			});
			insertedIds.push(id);
		}
		return { inserted: insertedIds.length, skipped, ids: insertedIds };
	},
});

export const getForProfile = internalQuery({
	args: { profileId: v.id("profiles"), status: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const status = String(args.status || "assigned").trim() || "assigned";
		const rows = await ctx.db
			.query("instagramAccounts")
			.withIndex("by_assignedTo_status", (q) => q.eq("assignedTo", args.profileId).eq("status", status as any))
			.collect();
		rows.sort((a, b) => a.createdAt - b.createdAt);
		return rows;
	},
});

export const getToMessage = internalQuery({
	args: {
		profileId: v.id("profiles"),
		cooldownHours: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const rows = await ctx.db
			.query("instagramAccounts")
			.withIndex("by_assignedTo", (q) => q.eq("assignedTo", args.profileId))
			.collect();
		const cooldownHours = Math.max(0, Number(args.cooldownHours ?? 0));
		const cutoffMs = Date.now() - cooldownHours * 60 * 60 * 1000;
		const filtered = rows.filter((r) => {
			if (r.message !== false) return false;
			if (cooldownHours <= 0) return true;
			if (typeof r.lastMessagedAt !== "number") return true;
			return r.lastMessagedAt <= cutoffMs;
		});
		filtered.sort((a, b) => a.createdAt - b.createdAt);
		return filtered;
	},
});

export const updateStatus = internalMutation({
	args: {
		accountId: v.id("instagramAccounts"),
		status: v.union(
			v.literal("available"),
			v.literal("assigned"),
			v.literal("subscribed"),
			v.literal("unsubscribed"),
			v.literal("skipped"),
			v.literal("done"),
		),
		assignedTo: v.optional(v.union(v.null(), v.id("profiles"))),
	},
	handler: async (ctx, args) => {
		const patch: Record<string, unknown> = { status: args.status };
		if (args.status === "subscribed") {
			patch.subscribedAt = Date.now();
		}
		if (typeof args.assignedTo !== "undefined") {
			patch.assignedTo = args.assignedTo === null ? undefined : args.assignedTo;
		}
		await ctx.db.patch(args.accountId, patch as any);
		return await ctx.db.get(args.accountId);
	},
});

export const updateMessage = internalMutation({
	args: {
		userName: v.string(),
		message: v.optional(v.boolean()),
		lastMessagedAt: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const normalized = normalizeUserName(args.userName);
		if (!normalized) return null;
		const rows = await ctx.db.query("instagramAccounts").collect();
		const lower = normalized.toLowerCase();
		const existing =
			rows.find((r) => r.userName === normalized) ?? rows.find((r) => String(r.userName || "").toLowerCase() === lower);
		if (!existing) return null;
		const nextMessage = args.message ?? true;
		const patch: Record<string, unknown> = { message: nextMessage };
		if (nextMessage) {
			patch.lastMessagedAt = typeof args.lastMessagedAt === "number" ? args.lastMessagedAt : Date.now();
		}
		await ctx.db.patch(existing._id, patch as any);
		return await ctx.db.get(existing._id);
	},
});



export const listUserNames = internalQuery({
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

export const listByStatus = internalQuery({
	args: { status: v.union(
		v.literal("available"),
		v.literal("assigned"),
		v.literal("subscribed"),
		v.literal("unsubscribed"),
		v.literal("skipped"),
		v.literal("done"),
	) },
	handler: async (ctx, args) => {
		const rows = await ctx.db
			.query("instagramAccounts")
			.withIndex("by_status", (q) => q.eq("status", args.status))
			.collect();
		rows.sort((a, b) => a.createdAt - b.createdAt);
		return rows;
	},
});

export const getProfilesWithAssignedAccounts = internalQuery({
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

export const _listAssignableProfiles = internalQuery({
	args: {},
	handler: async (ctx) => {
		const profiles = await ctx.db.query("profiles").collect();
		return profiles
			.filter((p: any) => {
				const listIds = Array.isArray(p.listIds) ? p.listIds : [];
				return listIds.length > 0;
			})
			.map((p) => ({
				profileId: p._id,
				assignedAccountsLimit: normalizeAssignedAccountsLimit(p.assignedAccountsLimit),
			}));
	},
});

export const _listAssignedAccountsForProfile = internalQuery({
	args: { profileId: v.id("profiles") },
	handler: async (ctx, args) => {
		const rows = await ctx.db
			.query("instagramAccounts")
			.withIndex("by_assignedTo_status", (q) => q.eq("assignedTo", args.profileId).eq("status", "assigned"))
			.collect();
		rows.sort((a, b) => b.createdAt - a.createdAt);
		return rows.map((row) => ({ _id: row._id, createdAt: row.createdAt }));
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

export const _bulkUnassignAccounts = internalMutation({
	args: { accountIds: v.array(v.id("instagramAccounts")) },
	handler: async (ctx, args) => {
		if (args.accountIds.length === 0) return true;
		await Promise.all(args.accountIds.map((id) => ctx.db.patch(id, { assignedTo: undefined, status: "available" })));
		return true;
	},
});

export const assignAvailableAccountsDaily = internalAction({
	args: {},
	handler: async (ctx) => {
		await ctx.runMutation(internal.profiles.mutations.backfillAssignedAccountsLimitDefaults, {});
		const profiles = await ctx.runQuery(internal.instagramAccounts._listAssignableProfiles, {});
		for (const profile of profiles) {
			const profileId = profile.profileId;
			const targetAssigned = normalizeAssignedAccountsLimit(profile.assignedAccountsLimit);
			const existingAssigned = await ctx.runQuery(internal.instagramAccounts._listAssignedAccountsForProfile, { profileId });
			if (existingAssigned.length > targetAssigned) {
				const overflow = existingAssigned.slice(0, existingAssigned.length - targetAssigned).map((row) => row._id);
				await ctx.runMutation(internal.instagramAccounts._bulkUnassignAccounts, { accountIds: overflow });
			}
			const currentAssigned = Math.min(existingAssigned.length, targetAssigned);
			const toAssign = Math.max(0, targetAssigned - currentAssigned);
			if (toAssign <= 0) continue;
			const available = await ctx.runQuery(internal.instagramAccounts._listAvailableAccountIds, { max: Math.max(toAssign * 10, 200) });
			if (available.length === 0) continue;
			for (let i = available.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[available[i], available[j]] = [available[j], available[i]];
			}
			const selected = available.slice(0, toAssign);
			if (selected.length === 0) continue;
			await ctx.runMutation(internal.instagramAccounts._bulkAssignAccounts, { profileId, accountIds: selected });
		}
		return true;
	},
});
