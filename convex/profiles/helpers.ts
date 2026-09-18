import { DomainError } from '../errors';
import { DEFAULT_MAX_PROFILES, proxyKey, resolveMaxProfiles } from '../proxies';
export function computeProfileMode(proxy: unknown): "proxy" | "direct" {
	const s = typeof proxy === "string" ? proxy.trim() : "";
	return s ? "proxy" : "direct";
}

export function getProfileListIds(profile: any): any[] {
	const merged = Array.isArray(profile?.listIds) ? profile.listIds : [];
	const seen = new Set<string>();
	const deduped: any[] = [];
	for (const id of merged) {
		const key = String(id || "").trim();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		deduped.push(id);
	}
	return deduped;
}

export function buildListPatch(listIds: any[]): { listIds: any[] } {
	return {
		listIds,
	};
}

export function normalizeProfileRow(profile: any) {
	return profile ?? null;
}

// Saved proxies stay in sync with profiles: whenever a profile is saved
// with a proxy, keep a matching row in the proxies table (deduped by
// proxy value so shared proxies only appear once). Runs inside the same
// mutation so it covers UI, API and internal callers.
export async function ensureProxySaved(ctx: any, proxyRaw: unknown, proxyTypeRaw: unknown, suggestedName: unknown) {
	const proxyType = typeof proxyTypeRaw === "string" ? proxyTypeRaw.trim().toLowerCase() : "http";
	if (proxyType !== "http" && proxyType !== "socks5") return;
	// Store the canonical type://rest form so bare "host:port" values dedup
	// against existing rows instead of creating a second row per format.
	const canonical = proxyKey(proxyRaw, proxyType);
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

export async function getAvailableProfilesForLists(ctx: any, listIdsRaw: string[], cooldownMinutesRaw: number) {
	const cleanIds = (listIdsRaw || []).map((v) => String(v || "").trim()).filter(Boolean);
	if (cleanIds.length === 0) return [];
	const cooldownMs = Math.max(0, (Number.isFinite(cooldownMinutesRaw) ? cooldownMinutesRaw : 0) * 60 * 1000);
	const cutoffMs = Date.now() - cooldownMs;
	const allowed = new Set(cleanIds);
	const rows = await ctx.db.query("profiles").collect();
	const filtered = rows.filter((p: any) => {
		const listIds = getProfileListIds(p);
		if (!listIds.some((listId) => allowed.has(String(listId)))) return false;
		if (typeof p.lastOpenedAt !== "number") return true;
		return p.lastOpenedAt < cutoffMs;
	});
	filtered.sort((a: any, b: any) => a.createdAt - b.createdAt);
	return filtered;
}

export async function getProfilesByListIds(ctx: any, listIdsRaw: string[]) {
	const cleanIds = (listIdsRaw || []).map((v) => String(v || "").trim()).filter(Boolean);
	if (cleanIds.length === 0) return [];
	const allowed = new Set(cleanIds);
	const rows = await ctx.db.query("profiles").collect();
	const filtered = rows.filter((p: any) => {
		const listIds = getProfileListIds(p);
		return listIds.some((listId) => allowed.has(String(listId)));
	});
	filtered.sort((a: any, b: any) => a.createdAt - b.createdAt);
	return filtered;
}

export async function createProfileRow(ctx: any, args: any) {
	const name = String(args.name || "").trim();
	if (!name) throw new DomainError('VALIDATION', "name is required");
	const proxy = typeof args.proxy === "string" ? args.proxy : undefined;
	const cookiesJsonRaw = typeof args.cookiesJson === "string" ? args.cookiesJson.trim() : "";

	await assertProxyLimit(ctx, proxy, args.proxyType, null);
	const id = await ctx.db.insert("profiles", {
		createdAt: Date.now(),
		name,
		proxy,
		proxyType: args.proxyType,
		status: "idle",
		mode: computeProfileMode(proxy),
		cookiesJson: cookiesJsonRaw ? cookiesJsonRaw : undefined,
		using: false,
		fingerprintOs: args.fingerprintOs,
		listIds: [],
		lastOpenedAt: undefined,
	});
	await ensureProxySaved(ctx, proxy, args.proxyType, name);
	return await ctx.db.get(id);
}

export async function updateProfileByNameRow(ctx: any, args: any) {
	const oldClean = String(args.oldName || "").trim();
	if (!oldClean) throw new DomainError('VALIDATION', "old_name is required");
	const existing = await ctx.db
		.query("profiles")
		.withIndex("by_name", (q: any) => q.eq("name", oldClean))
		.first();
	if (!existing) throw new DomainError('NOT_FOUND', "Profile not found");

	const name = String(args.name || "").trim();
	if (!name) throw new DomainError('VALIDATION', "name is required");

	const next: Record<string, unknown> = { name };

	if (typeof args.proxy === "string") {
		next.proxy = args.proxy;
		next.mode = computeProfileMode(args.proxy);
	}
	if (typeof args.proxyType === "string") {
		next.proxyType = args.proxyType;
	}
	if (typeof args.fingerprintOs === "string") {
		next.fingerprintOs = args.fingerprintOs;
	}
	if (typeof args.cookiesJson === "string") {
		const cleaned = args.cookiesJson.trim();
		next.cookiesJson = cleaned ? cleaned : undefined;
	}
	const effectiveProxyByName = typeof args.proxy === "string" ? args.proxy : existing.proxy;
	const effectiveTypeByName = typeof args.proxyType === "string" ? args.proxyType : existing.proxyType;
	if (proxyKey(effectiveProxyByName, effectiveTypeByName) !== proxyKey(existing.proxy, existing.proxyType)) {
		await assertProxyLimit(ctx, effectiveProxyByName, effectiveTypeByName, existing._id);
	}
	await ctx.db.patch(existing._id, {
		...(next as any),
	});
	await ensureProxySaved(
		ctx,
		typeof args.proxy === "string" ? args.proxy : existing.proxy,
		typeof args.proxyType === "string" ? args.proxyType : existing.proxyType,
		name,
	);
	return await ctx.db.get(existing._id);
}

export async function updateProfileByIdRow(ctx: any, args: any) {
	const name = String(args.name || "").trim();
	if (!name) throw new DomainError('VALIDATION', "name is required");
	const existing = await ctx.db.get(args.profileId);
	if (!existing) throw new DomainError('NOT_FOUND', "Profile not found");

	const next: Record<string, unknown> = { name };

	if (typeof args.proxy === "string") {
		next.proxy = args.proxy;
		next.mode = computeProfileMode(args.proxy);
	}
	if (typeof args.proxyType === "string") {
		next.proxyType = args.proxyType;
	}
	if (typeof args.fingerprintOs === "string") {
		next.fingerprintOs = args.fingerprintOs;
	}
	if (typeof args.cookiesJson === "string") {
		const cleaned = args.cookiesJson.trim();
		next.cookiesJson = cleaned ? cleaned : undefined;
	}
	const effectiveProxyById = typeof args.proxy === "string" ? args.proxy : existing.proxy;
	const effectiveTypeById = typeof args.proxyType === "string" ? args.proxyType : existing.proxyType;
	if (proxyKey(effectiveProxyById, effectiveTypeById) !== proxyKey(existing.proxy, existing.proxyType)) {
		await assertProxyLimit(ctx, effectiveProxyById, effectiveTypeById, args.profileId);
	}
	await ctx.db.patch(args.profileId, {
		...(next as any),
	});
	await ensureProxySaved(
		ctx,
		typeof args.proxy === "string" ? args.proxy : existing.proxy,
		typeof args.proxyType === "string" ? args.proxyType : existing.proxyType,
		name,
	);
	return await ctx.db.get(args.profileId);
}

export async function removeProfileByNameRow(ctx: any, name: string) {
	const cleaned = String(name || "").trim();
	if (!cleaned) throw new DomainError('VALIDATION', "name is required");
	const existing = await ctx.db
		.query("profiles")
		.withIndex("by_name", (q: any) => q.eq("name", cleaned))
		.first();
	if (!existing) return true;
	await ctx.db.delete(existing._id);
	return true;
}

export async function removeProfileByIdRow(ctx: any, profileId: any) {
	const existing = await ctx.db.get(profileId);
	if (!existing) return true;
	await ctx.db.delete(profileId);
	return true;
}

export async function syncProfileStatusRow(ctx: any, name: string, status: string, using?: boolean) {
	const cleanedName = String(name || "").trim();
	const cleanedStatus = String(status || "").trim();
	if (!cleanedName || !cleanedStatus) throw new DomainError('VALIDATION', "name and status are required");
	const existing = await ctx.db
		.query("profiles")
		.withIndex("by_name", (q: any) => q.eq("name", cleanedName))
		.first();
	if (!existing) return true;
	const next: Record<string, unknown> = { status: cleanedStatus, using: Boolean(using) };
	if (cleanedStatus.toLowerCase() === "running") {
		next.lastOpenedAt = Date.now();
	}
	await ctx.db.patch(existing._id, next as any);
	return true;
}

export async function listAssignedProfilesRow(ctx: any, listId: any) {
	const rows = await ctx.db.query("profiles").collect();
	const result = rows
		.filter((r: any) => getProfileListIds(r).some((id) => String(id) === String(listId)))
		.map((r: any) => ({ _id: r._id, name: r.name, createdAt: r.createdAt }))
		.sort((a: any, b: any) => a.createdAt - b.createdAt)
		.map((r: any) => ({ profileId: r._id, name: r.name }));
	return result;
}

export async function listUnassignedProfilesRow(ctx: any) {
	const rows = await ctx.db.query("profiles").collect();
	const result = rows
		.filter((r: any) => getProfileListIds(r).length === 0)
		.map((r: any) => ({ _id: r._id, name: r.name, createdAt: r.createdAt }))
		.sort((a: any, b: any) => a.createdAt - b.createdAt)
		.map((r: any) => ({ profileId: r._id, name: r.name }));
	return result;
}

export async function bulkSetProfileListIdRow(ctx: any, profileIds: any[], listId: any) {
	if (!Array.isArray(profileIds) || profileIds.length === 0) return true;
	const nextListIds = listId === null || typeof listId === "undefined" ? [] : [listId];
	await Promise.all(profileIds.map((id) => ctx.db.patch(id, buildListPatch(nextListIds))));
	return true;
}

export async function bulkAddProfilesToListRow(ctx: any, profileIds: any[], listId: any) {
	if (!Array.isArray(profileIds) || profileIds.length === 0) return true;
	await Promise.all(
		profileIds.map(async (id) => {
			const row = await ctx.db.get(id);
			if (!row) return;
			const next = getProfileListIds(row);
			if (!next.some((existingListId) => String(existingListId) === String(listId))) {
				next.push(listId);
			}
			await ctx.db.patch(id, buildListPatch(next));
		}),
	);
	return true;
}

export async function bulkRemoveProfilesFromListRow(ctx: any, profileIds: any[], listId: any) {
	if (!Array.isArray(profileIds) || profileIds.length === 0) return true;
	await Promise.all(
		profileIds.map(async (id) => {
			const row = await ctx.db.get(id);
			if (!row) return;
			const next = getProfileListIds(row).filter((existingListId) => String(existingListId) !== String(listId));
			await ctx.db.patch(id, buildListPatch(next));
		}),
	);
	return true;
}
