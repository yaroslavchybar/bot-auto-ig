import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { mutation } from "../_generated/server";
import { DomainError } from '../errors';
import { proxyKey, proxyPurpose, resolveMaxProfiles } from '../proxies';
import { clearChatCounter, setChatCounterEnabled } from '../chatCache'

export const setIgState = mutation({
  args: {
    profileId: v.id('profiles'),
    igLoggedIn: v.optional(v.boolean()),
    outreachReady: v.optional(v.boolean()),
  },
  handler: async (ctx, { profileId, ...state }) => {
    const profile = await ctx.db.get(profileId)
    if (!profile || profile.status === 'deleting') throw new Error('Profile unavailable')
    if (
      Object.entries(state).some(
        ([key, value]) => value !== undefined && profile[key as keyof typeof profile] !== value,
      )
    )
      await ctx.db.patch(profileId, state)
    if (state.igLoggedIn !== undefined)
      await setChatCounterEnabled(ctx, profileId, state.igLoggedIn)
  },
})

export const setIgStateInternal = internalMutation({
  args: {
    profileId: v.id('profiles'),
    igLoggedIn: v.optional(v.boolean()),
    outreachReady: v.optional(v.boolean()),
  },
  handler: async (ctx, { profileId, igLoggedIn, outreachReady }) => {
    const profile = await ctx.db.get(profileId)
    if (!profile || profile.status === 'deleting')
      throw new DomainError('NOT_FOUND', 'Profile unavailable')
    if (igLoggedIn === undefined && outreachReady === undefined)
      throw new DomainError('VALIDATION', 'No IG state provided')
    const patch = {
      ...(igLoggedIn !== undefined ? { igLoggedIn } : {}),
      ...(outreachReady !== undefined ? { outreachReady } : {}),
    }
    if (
      Object.entries(patch).some(([key, value]) => profile[key as keyof typeof profile] !== value)
    )
      await ctx.db.patch(profileId, patch)
    if (igLoggedIn !== undefined) await setChatCounterEnabled(ctx, profileId, igLoggedIn)
  },
})

export const saveChatSessionInternal = internalMutation({
  args: {
    profileId: v.id('profiles'),
    storageId: v.id('_storage'),
    token: v.string(),
    expectedToken: v.optional(v.string()),
    sessionVersion: v.optional(v.literal(1)),
    reconnectRequired: v.optional(v.boolean()),
  },
  handler: async (ctx, { profileId, storageId, token, expectedToken, sessionVersion, reconnectRequired }) => {
    const profile = await ctx.db.get(profileId)
    if (!profile || profile.status === 'deleting') throw new Error('Profile unavailable')
    const existing = await ctx.db
      .query('chatSessions')
      .withIndex('by_profile', (q) => q.eq('profileId', profileId))
      .first()
    if (expectedToken !== undefined && existing?.token !== expectedToken)
      throw new Error('Chat session changed')
    if (!existing || existing.token !== token) await clearChatCounter(ctx, profileId)
    if (existing) {
      await ctx.db.patch(existing._id, {
        storageId,
        token,
        sessionVersion,
        reconnectRequired,
        viewerId: undefined,
        inboxSyncedAt: undefined,
        inboxThreadIds: undefined,
        unreadCount: undefined,
      })
      if (existing.storageId !== storageId) await ctx.storage.delete(existing.storageId)
    } else await ctx.db.insert('chatSessions', { profileId, storageId, token, sessionVersion, reconnectRequired })
    const membership = await ctx.db
      .query('chatMemberships')
      .withIndex('by_profile', (q) => q.eq('profileId', profileId))
      .first()
    if (!membership) await ctx.db.insert('chatMemberships', { profileId })
  },
})

export const deleteChatSessionInternal = internalMutation({
  args: { profileId: v.id('profiles') },
  handler: async (ctx, { profileId }) => {
    await clearChatCounter(ctx, profileId)
    const existing = await ctx.db
      .query('chatSessions')
      .withIndex('by_profile', (q) => q.eq('profileId', profileId))
      .first()
    if (existing) {
      await ctx.storage.delete(existing.storageId)
      await ctx.db.delete(existing._id)
    }
    for (const row of await ctx.db
      .query('chatMemberships')
      .withIndex('by_profile', (q) => q.eq('profileId', profileId))
      .collect())
      await ctx.db.delete(row._id)
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
    await ctx.db.patch(profile._id, { status: 'deleting' })
    await setChatCounterEnabled(ctx, profile._id, false)
    return { ...profile, status: 'deleting' }
  },
})

export const finishRenameInternal = internalMutation({
	args: { profileId: v.id('profiles') },
	handler: async (ctx, { profileId }) => {
		const profile = await ctx.db.get(profileId);
		if (!profile) return;
		if (profile.status === 'deleting') throw new DomainError('CONFLICT', 'Profile is being deleted');
		await ctx.db.patch(profileId, { renameFrom: undefined });
	},
});
import { createProfileRow, insertProfileRow, updateProfileByNameRow, updateProfileByIdRow, removeProfileByNameRow, removeProfileByIdRow, syncProfileStatusRow, bulkSetProfileListIdRow, bulkAddProfilesToListRow, bulkRemoveProfilesFromListRow } from "./helpers";
import { routineLists } from '../routinePolicy';

/** Create a batch and reserve permanent proxies in one Convex transaction. */
export const createForModelInternal = internalMutation({
  args: { modelId: v.id('lists'), accounts: v.array(v.object({ id: v.id('igAccounts'), username: v.string() })) },
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
    const names = new Set(profiles.flatMap(profile => [profile.name, profile.renameFrom]
      .filter((name): name is string => Boolean(name)).map(name => name.toLowerCase())));
    if (new Set(usernames.map(name => name.toLowerCase())).size !== usernames.length ||
      usernames.some(name => name === '.' || name === '..' || names.has(name.toLowerCase())))
      throw new DomainError('CONFLICT', 'An account username already has a profile');
    const owners = (await ctx.db.query('automations').collect())
      .filter(automation => automation.isActive !== false &&
        routineLists(automation).some(id => id === modelId));
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
        proxyType: proxy.proxyType, fingerprintOs: 'windows', listIds: [modelId],
        igAccountId: accounts[i].id });
      await ctx.db.insert('profileListAssignments', { profileId: id, listId: modelId });
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
