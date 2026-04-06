import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { mutation } from "../auth";
import {
	normalizeDailyScrapingLimit,
	backfillAssignedAccountsLimitRow,
	createProfileRow,
	updateProfileByNameRow,
	updateProfileByIdRow,
	removeProfileByNameRow,
	removeProfileByIdRow,
	syncProfileStatusRow,
	setProfileLoginTrueRow,
	bulkSetProfileListIdRow,
	bulkAddProfilesToListRow,
	bulkRemoveProfilesFromListRow,
	clearBusyProfilesForListsRow,
	incrementDailyScrapingUsedByName,
} from "./helpers";

const profileArgsShape = {
	name: v.string(),
	proxy: v.optional(v.string()),
	proxyType: v.optional(v.string()),
	testIp: v.optional(v.boolean()),
	fingerprintSeed: v.optional(v.string()),
	fingerprintOs: v.optional(v.string()),
	cookiesJson: v.optional(v.string()),
	sessionId: v.optional(v.string()),
	dailyScrapingLimit: v.optional(v.union(v.number(), v.null())),
	assignedAccountsLimit: v.optional(v.union(v.number(), v.null())),
};

export const create = mutation({
	args: profileArgsShape,
	handler: async (ctx, args) => {
		return await createProfileRow(ctx, args);
	},
});

export const createInternal = internalMutation({
	args: profileArgsShape,
	handler: async (ctx, args) => {
		return await createProfileRow(ctx, args);
	},
});

const updateByNameArgsShape = {
	oldName: v.string(),
	...profileArgsShape,
};

export const updateByName = mutation({
	args: updateByNameArgsShape,
	handler: async (ctx, args) => {
		return await updateProfileByNameRow(ctx, args);
	},
});

export const updateByNameInternal = internalMutation({
	args: updateByNameArgsShape,
	handler: async (ctx, args) => {
		return await updateProfileByNameRow(ctx, args);
	},
});

const updateByIdArgsShape = {
	profileId: v.id("profiles"),
	...profileArgsShape,
};

export const updateById = mutation({
	args: updateByIdArgsShape,
	handler: async (ctx, args) => {
		return await updateProfileByIdRow(ctx, args);
	},
});

export const updateByIdInternal = internalMutation({
	args: updateByIdArgsShape,
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

export const backfillAssignedAccountsLimitDefaults = internalMutation({
	args: {},
	handler: async (ctx) => {
		return await backfillAssignedAccountsLimitRow(ctx);
	},
});
