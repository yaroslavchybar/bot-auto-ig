import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { query } from "../auth";
import {
	listProfileRows,
	getProfileByNameRow,
	getAvailableProfilesForLists,
	getProfilesByListIds,
	listAssignedProfilesRow,
	listUnassignedProfilesRow,
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
