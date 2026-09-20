import { DomainError } from './errors';
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { normalizeProxy, proxyKey } from '../server/shared/proxy';
export { proxyKey } from '../server/shared/proxy';

export const DEFAULT_MAX_PROFILES = 3;

export function cleanProxyFields(proxy: unknown, proxyType: unknown) {
	try { return normalizeProxy(proxy, proxyType); }
	catch { throw new DomainError('VALIDATION', 'Invalid proxy URL or protocol'); }
}

export function resolveMaxProfiles(row: { maxProfiles?: unknown }): number {
	const n = typeof row.maxProfiles === "number" ? Math.floor(row.maxProfiles) : NaN;
	return Number.isFinite(n) && n >= 1 ? n : DEFAULT_MAX_PROFILES;
}

function cleanName(name: unknown) {
	const cleaned = String(name || "").trim();
	if (!cleaned) throw new DomainError('VALIDATION', "name is required");
	return cleaned;
}

function cleanMaxProfiles(maxProfiles: unknown): number {
	if (typeof maxProfiles === "undefined") return DEFAULT_MAX_PROFILES;
	const n = typeof maxProfiles === "number" ? Math.floor(maxProfiles) : NaN;
	if (!Number.isFinite(n) || n < 1) {
		throw new DomainError('VALIDATION', "limit must be at least 1");
	}
	return n;
}

export const list = query({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query("proxies").collect();
		rows.sort((a, b) => a.createdAt - b.createdAt);
		return rows.map((row) => ({ ...row, maxProfiles: resolveMaxProfiles(row) }));
	},
});

export const create = mutation({
	args: { name: v.string(), proxy: v.string(), proxyType: v.string(), maxProfiles: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const name = cleanName(args.name);
		const { proxy, proxyType } = cleanProxyFields(args.proxy, args.proxyType);
		if (!proxy) throw new DomainError('VALIDATION', 'proxy is required');
		const maxProfiles = cleanMaxProfiles(args.maxProfiles);
		const existing = await ctx.db
			.query("proxies")
			.withIndex("by_name", (q) => q.eq("name", name))
			.first();
		if (existing) throw new DomainError('VALIDATION', "Name already exists");
		const rows = await ctx.db.query('proxies').collect();
		if (rows.some(row => proxyKey(row.proxy, row.proxyType) === proxy))
			throw new DomainError('VALIDATION', 'Proxy already exists');
		const id = await ctx.db.insert("proxies", { name, proxy, proxyType, maxProfiles, createdAt: Date.now() });
		return await ctx.db.get(id);
	},
});

export const update = mutation({
	args: { id: v.id("proxies"), name: v.string(), proxy: v.string(), proxyType: v.string(), maxProfiles: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const name = cleanName(args.name);
		const { proxy, proxyType } = cleanProxyFields(args.proxy, args.proxyType);
		if (!proxy) throw new DomainError('VALIDATION', 'proxy is required');
		const maxProfiles = cleanMaxProfiles(args.maxProfiles);
		const existing = await ctx.db.get(args.id);
		if (!existing) throw new DomainError('NOT_FOUND', "Proxy not found");
		const rows = await ctx.db.query('proxies').collect();
		if (rows.some(row => row._id !== args.id && proxyKey(row.proxy, row.proxyType) === proxy))
			throw new DomainError('VALIDATION', 'Proxy already exists');
		if (name !== existing.name) {
			const clash = await ctx.db
				.query("proxies")
				.withIndex("by_name", (q) => q.eq("name", name))
				.first();
			if (clash) throw new DomainError('VALIDATION', "Name already exists");
		}
		const oldKey = proxyKey(existing.proxy, existing.proxyType);
		const profiles = await ctx.db.query('profiles').collect();
		const assigned = oldKey ? profiles.filter(profile => proxyKey(profile.proxy, profile.proxyType) === oldKey) : [];
		if (oldKey === proxy && assigned.length > maxProfiles)
			throw new DomainError('VALIDATION', 'Profile limit is too small for the assigned profiles');
		if (oldKey && oldKey !== proxy) {
			if (assigned.some(profile => profile.using || profile.status === 'running' || profile.status === 'starting' || profile.status === 'deleting' || profile.renameFrom))
				throw new DomainError('CONFLICT', 'Stop assigned profiles and wait for maintenance before changing their proxy');
			const targetCount = profiles.filter(profile => proxyKey(profile.proxy, profile.proxyType) === proxy).length;
			if (targetCount + assigned.length > maxProfiles)
				throw new DomainError('VALIDATION', 'Profile limit is too small for the assigned profiles');
			for (const profile of assigned) await ctx.db.patch(profile._id, { proxy, proxyType, mode: 'proxy' });
		}
		await ctx.db.patch(args.id, { name, proxy, proxyType, maxProfiles });
		return await ctx.db.get(args.id);
	},
});

export const remove = mutation({
	args: { id: v.id("proxies") },
	handler: async (ctx, args) => {
		const existing = await ctx.db.get(args.id);
		if (!existing) return true;
		const key = proxyKey(existing.proxy, existing.proxyType);
		const profiles = await ctx.db.query('profiles').collect();
		if (key && profiles.some(profile => proxyKey(profile.proxy, profile.proxyType) === key))
			throw new DomainError('CONFLICT', 'Reassign profiles before deleting this proxy');
		await ctx.db.delete(args.id);
		return true;
	},
});

// One-time backfill: save proxies currently stored on profiles that
// have no matching row yet. Deduped by proxy value; safe to rerun.
export const importFromProfiles = mutation({
	args: {},
	handler: async (ctx) => {
		const proxies = await ctx.db.query("proxies").collect();
		const seen = new Set(proxies.map((p) => proxyKey(p.proxy, p.proxyType)));
		const taken = new Set(proxies.map((p) => p.name));
		const profiles = await ctx.db.query("profiles").collect();
		profiles.sort((a, b) => a.createdAt - b.createdAt);
		let imported = 0;
		for (const profile of profiles) {
			const key = proxyKey(profile.proxy, profile.proxyType);
			if (!key || seen.has(key)) continue;
			const { proxyType } = normalizeProxy(key);
			const base = String((profile as any).name || "").trim() || key;
			let name = base;
			let n = 2;
			while (taken.has(name)) {
				name = `${base} ${n++}`;
			}
			await ctx.db.insert("proxies", { name, proxy: key, proxyType, maxProfiles: DEFAULT_MAX_PROFILES, createdAt: Date.now() });
			seen.add(key);
			taken.add(name);
			imported += 1;
		}
		return { imported };
	},
});
