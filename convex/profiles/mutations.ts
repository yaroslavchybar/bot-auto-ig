import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { mutation } from "../_generated/server";
import { backfillAssignedAccountsLimitRow, createProfileRow, updateProfileByNameRow, updateProfileByIdRow, removeProfileByNameRow, removeProfileByIdRow, syncProfileStatusRow, setProfileLoginTrueRow, bulkSetProfileListIdRow, bulkAddProfilesToListRow, bulkRemoveProfilesFromListRow, incrementDailyScrapingUsedByName } from "./helpers";

const profileArgsShape = {
	name: v.string(),
	proxy: v.optional(v.string()),
	proxyType: v.optional(v.string()),
	testIp: v.optional(v.boolean()),
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

export const removeByNameInternal = internalMutation({
	args: { name: v.string() },
	handler: async (ctx, args) => {
		return await removeProfileByNameRow(ctx, args.name);
	},
});

export const removeByIdInternal = internalMutation({
	args: { profileId: v.id("profiles") },
	handler: async (ctx, args) => {
		return await removeProfileByIdRow(ctx, args.profileId);
	},
});

export const syncStatusInternal = internalMutation({
	args: { name: v.string(), status: v.string(), using: v.optional(v.boolean()) },
	handler: async (ctx, args) => {
		return await syncProfileStatusRow(ctx, args.name, args.status, args.using);
	},
});

export const setLoginTrueInternal = internalMutation({
	args: { name: v.string() },
	handler: async (ctx, args) => {
		return await setProfileLoginTrueRow(ctx, args.name);
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

// Quota charges are internal-only: the server calls them through the
// INTERNAL_API_KEY-gated HTTP route. A public mutation would let any client
// inflate dailyScrapingUsed and spam scrapeQuotaCommits rows.
export const incrementDailyScrapingUsedInternal = internalMutation({
	args: { name: v.string(), amount: v.number(), commitKey: v.optional(v.string()) },
	handler: async (ctx, args) => {
		return await incrementDailyScrapingUsedByName(ctx, args.name, args.amount, args.commitKey);
	},
});

export const backfillAssignedAccountsLimitDefaults = internalMutation({
	args: {},
	handler: async (ctx) => {
		return await backfillAssignedAccountsLimitRow(ctx);
	},
});
