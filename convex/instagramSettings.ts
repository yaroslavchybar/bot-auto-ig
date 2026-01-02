import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const get = query({
	args: { scope: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const cleaned = String(args.scope || "global").trim() || "global";
		const row = await ctx.db
			.query("instagramSettings")
			.withIndex("by_scope", (q) => q.eq("scope", cleaned))
			.first();
		const value = row?.data;
		if (!value || typeof value !== "object" || Array.isArray(value)) return null;
		return value as Record<string, any>;
	},
});

export const upsert = mutation({
	args: { scope: v.optional(v.string()), data: v.any() },
	handler: async (ctx, args) => {
		const cleanedScope = String(args.scope || "global").trim() || "global";
		const data = args.data;
		if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("data must be an object");
		const existing = await ctx.db
			.query("instagramSettings")
			.withIndex("by_scope", (q) => q.eq("scope", cleanedScope))
			.first();
		const now = Date.now();
		if (existing) {
			await ctx.db.patch(existing._id, { data, updatedAt: now });
			return (await ctx.db.get(existing._id))?.data ?? null;
		}
		const id = await ctx.db.insert("instagramSettings", {
			scope: cleanedScope,
			data,
			createdAt: now,
			updatedAt: now,
		});
		return (await ctx.db.get(id))?.data ?? null;
	},
});

