import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { query } from "../_generated/server";
import {
	listProfileRows,
	getProfileByNameRow,
	getAvailableProfilesForLists,
	getProfilesByListIds,
	listAssignedProfilesRow,
	listUnassignedProfilesRow,
	normalizeProfileRow,
} from "./helpers";

export const listInternal = internalQuery({
	args: {},
	handler: async (ctx) => {
		return await listProfileRows(ctx);
	},
});

export const getByIdInternal = internalQuery({
	args: { profileId: v.id("profiles") },
	handler: async (ctx, args) => {
		return normalizeProfileRow((await ctx.db.get(args.profileId)) ?? null);
	},
});

export const list = query({
	args: {},
	handler: async (ctx) => {
		return await listProfileRows(ctx);
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
		return normalizeProfileRow((await ctx.db.get(args.profileId)) ?? null);
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

export const getByListIdsInternal = internalQuery({
	args: {
		listIds: v.array(v.string()),
	},
	handler: async (ctx, args) => {
		return await getProfilesByListIds(ctx, args.listIds);
	},
});

export const listAssignedInternal = internalQuery({
	args: { listId: v.id("lists") },
	handler: async (ctx, args) => {
		return await listAssignedProfilesRow(ctx, args.listId);
	},
});

export const listUnassignedInternal = internalQuery({
	args: {},
	handler: async (ctx) => {
		return await listUnassignedProfilesRow(ctx);
	},
});
