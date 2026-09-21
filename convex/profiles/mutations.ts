import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { mutation } from "../_generated/server";
import { DomainError } from '../errors';

export const setIgState = mutation({
  args: { profileId: v.id('profiles'), igLoggedIn: v.optional(v.boolean()), outreachReady: v.optional(v.boolean()) },
  handler: async (ctx, { profileId, ...state }) => {
    const profile = await ctx.db.get(profileId)
    if (!profile || profile.status === 'deleting') throw new Error('Profile unavailable')
    await ctx.db.patch(profileId, state)
  },
})

export const beginDeleteInternal = internalMutation({
	args: { name: v.string() },
	handler: async (ctx, { name }) => {
		const profile = await ctx.db.query('profiles').withIndex('by_name', q => q.eq('name', name)).first();
		if (!profile) return null;
		await ctx.db.patch(profile._id, { status: 'deleting' });
		return { ...profile, status: 'deleting' };
	},
});

export const finishRenameInternal = internalMutation({
	args: { profileId: v.id('profiles') },
	handler: async (ctx, { profileId }) => {
		const profile = await ctx.db.get(profileId);
		if (!profile) return;
		if (profile.status === 'deleting') throw new DomainError('CONFLICT', 'Profile is being deleted');
		await ctx.db.patch(profileId, { renameFrom: undefined });
	},
});
import { createProfileRow, updateProfileByNameRow, updateProfileByIdRow, removeProfileByNameRow, removeProfileByIdRow, syncProfileStatusRow, bulkSetProfileListIdRow, bulkAddProfilesToListRow, bulkRemoveProfilesFromListRow } from "./helpers";

const profileArgsShape = {
	name: v.string(),
	proxy: v.optional(v.string()),
	proxyType: v.optional(v.string()),
	fingerprintOs: v.optional(v.string()),
	cookiesJson: v.optional(v.string()),
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
