import { DomainError } from './errors';
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const PROXY_TYPES = ["http", "socks5"] as const;

export const DEFAULT_MAX_PROFILES = 3;

// Profiles reference proxies by value copy, so a proxy is identified by
// its canonical "type://value" key on both sides. The scheme is stripped
// before rebuilding so "host:port" and "http://host:port" match.
export function proxyKey(proxy: unknown, proxyType: unknown): string | null {
	const value = String(proxy || "").trim();
	if (!value) return null;
	const type = String(proxyType || "http").trim().toLowerCase() || "http";
	if (type !== "http" && type !== "socks5") return null;
	const bare = value.includes("://") ? value.slice(value.indexOf("://") + 3) : value;
	return `${type}://${bare}`;
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

function cleanProxyType(proxyType: unknown) {
	const cleaned = String(proxyType || "http").trim().toLowerCase();
	if (!PROXY_TYPES.includes(cleaned as (typeof PROXY_TYPES)[number])) {
		throw new DomainError('VALIDATION', "proxyType must be http or socks5");
	}
	return cleaned;
}

function cleanProxy(proxy: unknown) {
	const cleaned = String(proxy || "").trim();
	if (!cleaned) throw new DomainError('VALIDATION', "proxy is required");
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
		const proxy = cleanProxy(args.proxy);
		const proxyType = cleanProxyType(args.proxyType);
		const maxProfiles = cleanMaxProfiles(args.maxProfiles);
		const existing = await ctx.db
			.query("proxies")
			.withIndex("by_name", (q) => q.eq("name", name))
			.first();
		if (existing) throw new DomainError('VALIDATION', "Name already exists");
		const id = await ctx.db.insert("proxies", { name, proxy, proxyType, maxProfiles, createdAt: Date.now() });
		return await ctx.db.get(id);
	},
});

export const update = mutation({
	args: { id: v.id("proxies"), name: v.string(), proxy: v.string(), proxyType: v.string(), maxProfiles: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const name = cleanName(args.name);
		const proxy = cleanProxy(args.proxy);
		const proxyType = cleanProxyType(args.proxyType);
		const maxProfiles = cleanMaxProfiles(args.maxProfiles);
		const existing = await ctx.db.get(args.id);
		if (!existing) throw new DomainError('NOT_FOUND', "Proxy not found");
		if (name !== existing.name) {
			const clash = await ctx.db
				.query("proxies")
				.withIndex("by_name", (q) => q.eq("name", name))
				.first();
			if (clash) throw new DomainError('VALIDATION', "Name already exists");
		}
		await ctx.db.patch(args.id, { name, proxy, proxyType, maxProfiles });
		return await ctx.db.get(args.id);
	},
});

export const remove = mutation({
	args: { id: v.id("proxies") },
	handler: async (ctx, args) => {
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
			const proxyType = String((profile as any).proxyType || "http").trim().toLowerCase();
			if (proxyType !== "http" && proxyType !== "socks5") continue;
			const key = proxyKey((profile as any).proxy, proxyType);
			if (!key || seen.has(key)) continue;
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
