import { DomainError } from '../errors';
import { syncProxyUsage } from '../proxyUsage'
import { patchProfile, syncWorkerProfile } from '../workerMetadata'
import { deleteProfileData } from './cleanup'
import { DEFAULT_MAX_PROFILES, proxyKey, resolveMaxProfiles, cleanProxyFields } from '../proxies';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { recordedPostsReady } from '../modelSetupPolicy';

function assertProfileEditable(profile: any) {
	if (profile.status === 'deleting' || profile.pendingRenameFrom)
		throw new DomainError('CONFLICT', 'Profile maintenance is in progress');
}

function fingerprintPlatform(value: unknown): 'windows' | 'macos' {
	const os = String(value || '').trim().toLowerCase();
	return os === 'mac' || os === 'macos' ? 'macos' : 'windows';
}

async function assertProfileNameAvailable(ctx: any, name: string, exceptId?: string) {
	if (!name || name === '.' || name === '..' || name.includes('\0') || /[\\/<>:"|?*]/.test(name) || /[. ]$/.test(name) ||
		/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name))
		throw new DomainError('VALIDATION', 'Invalid profile name');
	const rows = await ctx.db.query('profiles').collect();
	if (rows.some((p: any) => p._id !== exceptId &&
		[p.name, p.pendingRenameFrom].some(n => n?.toLowerCase() === name.toLowerCase())))
		throw new DomainError('CONFLICT', 'Profile name is already in use');
}

/** Model moves restore readiness only for a previously completed setup of that model. */
async function changeProfileModel(ctx: MutationCtx, profile: Doc<'profiles'>, modelId: Id<'models'> | undefined) {
  await assertProfileModelChange(ctx, profile, modelId);
  if (profile.modelId === modelId) return;
  const setup = await ctx.db.query('modelSetupStates')
    .withIndex('by_profile', q => q.eq('profileId', profile._id)).first();
  const outreachReady = !!(setup && setup.modelId === modelId && setup.outreachReadyMarked &&
    !setup.pending && recordedPostsReady(setup.postSourceIds, setup.postDates));
  await ctx.db.patch(profile._id, { modelId, outreachReady });
}

/** The browser cookie jar is authoritative; a missing session clears stale auth. */
function sessionIdFromCookies(raw: string): string | undefined {
	try {
		const cookies = JSON.parse(raw);
		if (!Array.isArray(cookies)) return undefined;
		const cookie = cookies.find((item: any) => item?.name === 'sessionid' &&
			/(^|\.)instagram\.com$/i.test(String(item?.domain ?? '')));
		return typeof cookie?.value === 'string' && cookie.value ? cookie.value : undefined;
	} catch { return undefined; }
}

// Saved proxies stay in sync with profiles: whenever a profile is saved
// with a proxy, keep a matching row in the proxies table (deduped by
// proxy value so shared proxies only appear once). Runs inside the same
// mutation so it covers UI, API and internal callers.
export async function ensureProxySaved(ctx: any, proxyRaw: unknown, proxyTypeRaw: unknown, suggestedName: unknown) {
	const { proxy: canonical, proxyType } = cleanProxyFields(proxyRaw, proxyTypeRaw);
	if (!canonical) return;
	const rows = await ctx.db.query("proxies").collect();
	if (rows.some((p: any) => proxyKey(p.proxy, p.proxyType) === canonical)) return;
	const base = String(suggestedName || "").trim() || canonical;
	const taken = new Set(rows.map((p: any) => String(p.name)));
	let name = base;
	let n = 2;
	while (taken.has(name)) {
		name = `${base} ${n++}`;
	}
	await ctx.db.insert("proxies", { name, proxy: canonical, proxyType, maxProfiles: DEFAULT_MAX_PROFILES, createdAt: Date.now() });
}

// Blocks assigning a proxy that already reached its profile limit.
// Only runs for new assignments: edits that keep the current proxy
// always pass so legacy over-limit profiles stay editable.
async function assertProxyLimit(ctx: any, proxyRaw: unknown, proxyTypeRaw: unknown, excludeProfileId: unknown) {
	const key = proxyKey(proxyRaw, proxyTypeRaw);
	if (!key) return;
	const [proxies, profiles] = await Promise.all([
		ctx.db.query("proxies").collect(),
		ctx.db.query("profiles").collect(),
	]);
	const row = proxies.find((p: any) => proxyKey(p.proxy, p.proxyType) === key);
	if (row?.purpose === 'login') throw new DomainError('VALIDATION', 'Login proxies cannot be assigned to profiles');
	const limit = row ? resolveMaxProfiles(row) : DEFAULT_MAX_PROFILES;
	const used = profiles.filter((p: any) =>
		String(p._id) !== String(excludeProfileId) && proxyKey(p.proxy, p.proxyType) === key,
	);
	if (used.length >= limit) {
		throw new DomainError('VALIDATION', `Proxy "${row ? row.name : key}" already used by ${used.length} profiles (limit ${limit})`);
	}
}

export async function listProfileRows(ctx: any) {
	const rows = await ctx.db.query("profiles").collect();
	rows.sort((a: any, b: any) => a.createdAt - b.createdAt);
	return rows;
}

export async function getProfileByNameRow(ctx: any, name: string) {
	const cleaned = String(name || "").trim();
	if (!cleaned) return null;
	const row = await ctx.db
		.query("profiles")
		.withIndex("by_name", (q: any) => q.eq("name", cleaned))
		.first();
	return row ?? null;
}

export async function createProfileRow(ctx: any, args: any) {
	args = { ...args, ...cleanProxyFields(args.proxy, args.proxyType) };
	const name = String(args.name || "").trim();
	if (!name) throw new DomainError('VALIDATION', "name is required");
	await assertProfileNameAvailable(ctx, name);
	const proxy = typeof args.proxy === "string" ? args.proxy : undefined;
	const cookiesJsonRaw = typeof args.cookiesJson === "string" ? args.cookiesJson.trim() : "";

	await assertProxyLimit(ctx, proxy, args.proxyType, null);
	const id = await insertProfileRow(ctx, { ...args, name, proxy, cookiesJson: cookiesJsonRaw });
	await ensureProxySaved(ctx, proxy, args.proxyType, name);
	return await ctx.db.get(id);
}

/** Insert a profile after its name and proxy capacity have been checked. */
export async function insertProfileRow(ctx: any, args: any) {
	const cookiesJsonRaw = typeof args.cookiesJson === "string" ? args.cookiesJson.trim() : "";
	const id = await ctx.db.insert("profiles", {
		createdAt: Date.now(),
		name: args.name,
		igAccountId: args.igAccountId,
		proxy: args.proxy,
		proxyType: args.proxyType,
		status: "idle",
		cookiesJson: cookiesJsonRaw ? cookiesJsonRaw : undefined,
		instagramSessionId: sessionIdFromCookies(cookiesJsonRaw),
		inUse: false,
		fingerprintOs: args.fingerprintOs,
		fingerprintSeed: args.fingerprintSeed,
		modelId: args.modelId,
		lastOpenedAt: undefined,
	});
	await syncProxyUsage(ctx, { _id: id, name: args.name, proxy: args.proxy, proxyType: args.proxyType });
	await syncWorkerProfile(ctx, (await ctx.db.get(id))!);
	return id;
}

export async function updateProfileByNameRow(ctx: any, args: any) {
	const oldClean = String(args.oldName || "").trim();
	if (!oldClean) throw new DomainError('VALIDATION', "old_name is required");
	const existing = await ctx.db
		.query("profiles")
		.withIndex("by_name", (q: any) => q.eq("name", oldClean))
		.first();
	if (!existing) throw new DomainError('NOT_FOUND', "Profile not found");
	if (args.browserSessionId !== undefined && (existing.browserSessionId !== args.browserSessionId || !existing.inUse || existing.status !== 'running'))
		throw new DomainError('CONFLICT', 'Browser session no longer owns this profile');
	if (typeof args.cookiesJson === 'string' && args.browserSessionId === undefined && (existing.inUse || existing.status === 'running'))
		throw new DomainError('CONFLICT', 'Close the browser before importing cookies');
	assertProfileEditable(existing);
	args = { ...args, ...cleanProxyFields(args.proxy ?? existing.proxy, args.proxyType ?? existing.proxyType) };

	const name = String(args.name || "").trim();
	if (!name) throw new DomainError('VALIDATION', "name is required");

	const next: Record<string, unknown> = { name };
	if (name !== existing.name) await assertProfileNameAvailable(ctx, name, existing._id);
	if (name !== existing.name) next.pendingRenameFrom = existing.name;

	if (typeof args.proxy === "string") {
		next.proxy = args.proxy;
	}
	if (typeof args.proxyType === "string") {
		next.proxyType = args.proxyType;
	}
	if (typeof args.fingerprintOs === "string") {
		next.fingerprintOs = args.fingerprintOs;
	}
	if (typeof args.fingerprintOs === "string" && fingerprintPlatform(args.fingerprintOs) !== fingerprintPlatform(existing.fingerprintOs)) {
		next.fingerprintSeed = undefined;
	} else if (typeof args.fingerprintSeed === "number" && Number.isSafeInteger(args.fingerprintSeed)) {
		next.fingerprintSeed = args.fingerprintSeed;
	}
	if (typeof args.cookiesJson === "string") {
		const cleaned = args.cookiesJson.trim();
		next.cookiesJson = cleaned ? cleaned : undefined;
		next.instagramSessionId = sessionIdFromCookies(cleaned);
		if (args.browserSessionId === undefined) next.browserSessionRevision = (existing.browserSessionRevision ?? 0) + 1;
	}
	const effectiveProxyByName = typeof args.proxy === "string" ? args.proxy : existing.proxy;
	const effectiveTypeByName = typeof args.proxyType === "string" ? args.proxyType : existing.proxyType;
	if (proxyKey(effectiveProxyByName, effectiveTypeByName) !== proxyKey(existing.proxy, existing.proxyType)) {
		await assertProxyLimit(ctx, effectiveProxyByName, effectiveTypeByName, existing._id);
	}
	if (Object.entries(next).some(([key, value]) => existing[key] !== value))
    await patchProfile(ctx, existing._id, next as any);
	await syncProxyUsage(ctx, { _id: existing._id, name, proxy: effectiveProxyByName, proxyType: effectiveTypeByName });
	await ensureProxySaved(
		ctx,
		typeof args.proxy === "string" ? args.proxy : existing.proxy,
		typeof args.proxyType === "string" ? args.proxyType : existing.proxyType,
		name,
	);
	return await ctx.db.get(existing._id);
}

export async function removeProfileByIdRow(ctx: MutationCtx, profileId: Id<'profiles'>) {
  const existing = await ctx.db.get(profileId)
  if (existing && existing.status !== 'deleting')
    throw new DomainError('CONFLICT', 'Begin profile deletion first')
  await deleteProfileData(ctx, profileId)
  if (existing) await ctx.db.delete(profileId)
  return true
}

export async function syncProfileStatusRow(ctx: any, name: string, status: string, inUse?: boolean, browserSessionId?: string,
  claim?: { profileId?: Id<'profiles'>; previousBrowserSessionRevision: number }) {
	const cleanedName = String(name || "").trim();
	const cleanedStatus = String(status || "").trim();
	if (!cleanedName || !cleanedStatus) throw new DomainError('VALIDATION', "name and status are required");
	const existing = await ctx.db
		.query("profiles")
		.withIndex("by_name", (q: any) => q.eq("name", cleanedName))
		.first();
	if (!existing) return !claim;
	if (existing.status === 'deleting') return !claim;
	const alreadyOwned = existing.browserSessionId === browserSessionId && existing.inUse && existing.status === 'running';
	if (cleanedStatus === 'running' && claim && (existing._id !== claim.profileId ||
		((existing.browserSessionRevision ?? 0) !== claim.previousBrowserSessionRevision && !alreadyOwned))) return false;
	// A disconnected lease can precede its initial claim. Retire that revision
	// atomically so the delayed running request cannot revive the dead worker.
	const retirePendingClaim = cleanedStatus === 'idle' && browserSessionId !== undefined && claim !== undefined &&
		existing._id === claim.profileId && (existing.browserSessionRevision ?? 0) === claim.previousBrowserSessionRevision;
	if (cleanedStatus !== 'running' && claim && existing._id !== claim.profileId) return false;
	if (cleanedStatus !== 'running' && browserSessionId !== undefined && existing.browserSessionId !== browserSessionId && !retirePendingClaim) return false;
	const next: Record<string, unknown> = { status: cleanedStatus, inUse: Boolean(inUse) };
	next.browserSessionId = cleanedStatus === 'running' || retirePendingClaim ? browserSessionId : existing.browserSessionId;
	if ((cleanedStatus === 'running' && !alreadyOwned) || retirePendingClaim) next.browserSessionRevision = (existing.browserSessionRevision ?? 0) + 1;
  if (existing.status === cleanedStatus && existing.inUse === Boolean(inUse) && existing.browserSessionId === next.browserSessionId && next.browserSessionRevision === undefined) return true;
	if (cleanedStatus.toLowerCase() === "running") {
		next.lastOpenedAt = Date.now();
	}
	await patchProfile(ctx, existing._id, next as any);
	return true;
}

export async function bulkAddProfilesToModelRow(ctx: any, profileIds: any[], modelId: any) {
	if (!Array.isArray(profileIds) || profileIds.length === 0) return true;
	if (!await ctx.db.get(modelId)) throw new DomainError('NOT_FOUND', 'Model not found');
	// Single-list invariant: a profile lives in at most one list.
	// Adding to a new list moves it (replaces), it never copies.
	await Promise.all(
		profileIds.map(async (id) => {
			const row = await ctx.db.get(id);
			if (!row) return;
			await changeProfileModel(ctx, row, modelId);
		}),
	);
    await assertAssignments(ctx);
	return true;
}

export async function bulkRemoveProfilesFromModelRow(ctx: any, profileIds: any[], modelId: any) {
	if (!Array.isArray(profileIds) || profileIds.length === 0) return true;
	await Promise.all(
		profileIds.map(async (id) => {
			const row = await ctx.db.get(id);
			if (!row) return;
			if (row.modelId === modelId) await changeProfileModel(ctx, row, undefined);
		}),
	);
	await assertAssignments(ctx);
	return true;
}
import { assertAssignments } from '../routines';

// A model move must not discard an action whose Instagram result is still unknown.
async function assertProfileModelChange(ctx: MutationCtx, profile: Doc<'profiles'>, next: Id<'models'> | undefined) {
  if (!profile) return;
  if (profile.modelId === next) return;
  if (profile.inUse || ['running', 'starting', 'deleting'].includes(profile.status ?? '') || profile.pendingRenameFrom)
    throw new DomainError('CONFLICT', 'Stop the profile and wait for maintenance before changing models');
  const setup = await ctx.db.query('modelSetupStates')
    .withIndex('by_profile', q => q.eq('profileId', profile._id)).first();
  if (setup?.pending)
    throw new DomainError('CONFLICT', 'Resolve the pending model setup action before changing models');
}
