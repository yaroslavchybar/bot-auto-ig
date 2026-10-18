import { patchProfile } from '../workerMetadata'
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { mutation } from "../_generated/server";
import { DomainError } from '../errors';
import { proxyKey, proxyPurpose, resolveMaxProfiles } from '../proxies';
import { setProfilePaused } from '../profilePause'
import { cleanupProfileReferences } from './cleanup'

export const setPaused = mutation({
  args: { profileId: v.id('profiles'), paused: v.boolean() },
  handler: async (ctx, { profileId, paused }) => setProfilePaused(ctx, profileId, paused),
})

export const saveUnreadChatsInternal = internalMutation({
  args: { profileId: v.id('profiles'), count: v.number(), checkedAt: v.number() },
  handler: async (ctx, { profileId, count, checkedAt }) => {
    if (!Number.isSafeInteger(count) || count < 0 || count > 1_000_000
      || !Number.isSafeInteger(checkedAt) || checkedAt < 0 || checkedAt > Date.now() + 60_000)
      throw new DomainError('VALIDATION', 'Invalid unread chat count')
    const profile = await ctx.db.get(profileId)
    if (!profile || profile.status === 'deleting' || (profile.unreadChatsCheckedAt ?? -1) > checkedAt) return
    await ctx.db.patch(profileId, { unreadChatCount: count, unreadChatsCheckedAt: checkedAt })
  },
})

export const setIgState = mutation({
  args: {
    profileId: v.id('profiles'),
    igLoggedIn: v.boolean(),
  },
  handler: async (ctx, { profileId, ...state }) => {
    const profile = await ctx.db.get(profileId)
    if (!profile || profile.status === 'deleting') throw new Error('Profile unavailable')
    if (
      Object.entries(state).some(
        ([key, value]) => value !== undefined && profile[key as keyof typeof profile] !== value,
      )
    )
      await patchProfile(ctx, profileId, state)
  },
})

export const setIgStateInternal = internalMutation({
  args: {
    profileId: v.id('profiles'),
    igLoggedIn: v.boolean(),
  },
  handler: async (ctx, { profileId, igLoggedIn }) => {
    const profile = await ctx.db.get(profileId)
    if (!profile || profile.status === 'deleting')
      throw new DomainError('NOT_FOUND', 'Profile unavailable')
    if (profile.igLoggedIn !== igLoggedIn) await patchProfile(ctx, profileId, { igLoggedIn })
  },
})

export const beginDeleteInternal = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const profile = await ctx.db
      .query('profiles')
      .withIndex('by_name', (q) => q.eq('name', name))
      .first()
    if (!profile) return null
    await patchProfile(ctx, profile._id, { status: 'deleting' })
    return { ...profile, status: 'deleting' }
  },
})

export const finishRenameInternal = internalMutation({
	args: { profileId: v.id('profiles') },
	handler: async (ctx, { profileId }) => {
		const profile = await ctx.db.get(profileId);
		if (!profile) return;
		if (profile.status === 'deleting') throw new DomainError('CONFLICT', 'Profile is being deleted');
		await patchProfile(ctx, profileId, { pendingRenameFrom: undefined });
	},
});
import { createProfileRow, insertProfileRow, updateProfileByNameRow, updateProfileByIdRow, removeProfileByNameRow, removeProfileByIdRow, syncProfileStatusRow, bulkAddProfilesToModelRow, bulkRemoveProfilesFromModelRow } from "./helpers";
import { routineModels } from '../routinePolicy';

/** Create a batch and reserve permanent proxies in one Convex transaction. */
export const createForModelInternal = internalMutation({
  args: { modelId: v.id('models'), accounts: v.array(v.object({ id: v.id('igAccounts'), username: v.string() })) },
  handler: async (ctx, { modelId, accounts }) => {
    const usernames = accounts.map(account => account.username);
    if (!await ctx.db.get(modelId)) throw new DomainError('NOT_FOUND', 'Model not found');
    if (!usernames.length || usernames.length > 100) throw new DomainError('VALIDATION', 'Create 1–100 profiles');
    if (new Set(accounts.map(account => account.id)).size !== accounts.length)
      throw new DomainError('VALIDATION', 'Duplicate credentials');
    for (const account of accounts) {
      const stored = await ctx.db.get(account.id);
      if (!stored || stored.status !== 'available') throw new DomainError('CONFLICT', 'Credential is not available');
    }
    if (new Set(usernames).size !== usernames.length || usernames.some(name => !/^[a-zA-Z0-9._]{1,30}$/.test(name)))
      throw new DomainError('VALIDATION', 'Invalid or duplicate account usernames');
    const profiles = await ctx.db.query('profiles').collect();
    const names = new Set(profiles.flatMap(profile => [profile.name, profile.pendingRenameFrom]
      .filter((name): name is string => Boolean(name)).map(name => name.toLowerCase())));
    if (new Set(usernames.map(name => name.toLowerCase())).size !== usernames.length ||
      usernames.some(name => name === '.' || name === '..' || names.has(name.toLowerCase())))
      throw new DomainError('CONFLICT', 'An account username already has a profile');
    const owners = (await ctx.db.query('automations').collect())
      .filter(automation => automation.isActive !== false &&
        routineModels(automation).some(id => id === modelId));
    if (owners.length > 1)
      throw new DomainError('CONFLICT', 'Model belongs to multiple enabled automations');
    const proxies = await ctx.db.query('proxies').collect();
    const counts = new Map<string, number>();
    for (const profile of profiles) {
      const key = proxyKey(profile.proxy, profile.proxyType);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const selected: typeof proxies = [];
    for (const _ of usernames) {
      const free = proxies.find(proxy => {
        const key = proxyKey(proxy.proxy, proxy.proxyType);
        return proxyPurpose(proxy) === 'work' && key !== null &&
          (counts.get(key) ?? 0) < resolveMaxProfiles(proxy);
      });
      if (!free) throw new DomainError('VALIDATION', 'Not enough proxy capacity for this batch');
      selected.push(free);
      const key = proxyKey(free.proxy, free.proxyType);
      if (!key) throw new DomainError('VALIDATION', 'Saved proxy is invalid');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const ids = [];
    for (let i = 0; i < usernames.length; i++) {
      const proxy = selected[i];
      const id = await insertProfileRow(ctx, { name: usernames[i], proxy: proxy.proxy,
        proxyType: proxy.proxyType, fingerprintOs: 'windows', modelIds: [modelId],
        igAccountId: accounts[i].id });
      await ctx.db.insert('profileModelAssignments', { profileId: id, modelId: modelId });
      await ctx.db.patch(accounts[i].id, { status: 'assigned', profileId: id,
        error: undefined, retryAfter: undefined, browserLoggedInAt: undefined });
      ids.push(id);
    }
    return ids.map((id, index) => ({ profileId: id, username: usernames[index] }));
  },
});

const profileArgsShape = {
	name: v.string(),
	proxy: v.optional(v.string()),
	proxyType: v.optional(v.string()),
	fingerprintOs: v.optional(v.string()),
	fingerprintSeed: v.optional(v.number()),
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

export const cleanupDeletedProfileReferencesInternal = internalMutation({
  args: { profileId: v.id('profiles') },
  handler: async (ctx, { profileId }): Promise<void> => {
    if (await ctx.db.get(profileId)) throw new Error('Profile still exists')
    await cleanupProfileReferences(ctx, profileId)
  },
})

export const syncStatusInternal = internalMutation({
	args: { name: v.string(), status: v.string(), inUse: v.optional(v.boolean()) },
	handler: async (ctx, args) => {
		return await syncProfileStatusRow(ctx, args.name, args.status, args.inUse);
	},
});

export const bulkAddToModel = mutation({
	args: { profileIds: v.array(v.id("profiles")), modelId: v.id("models") },
	handler: async (ctx, args) => {
		return await bulkAddProfilesToModelRow(ctx, args.profileIds, args.modelId);
	},
});

export const bulkRemoveFromModel = mutation({
	args: { profileIds: v.array(v.id("profiles")), modelId: v.id("models") },
	handler: async (ctx, args) => {
		return await bulkRemoveProfilesFromModelRow(ctx, args.profileIds, args.modelId);
	},
});
