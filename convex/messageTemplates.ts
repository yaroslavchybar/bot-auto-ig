import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const get = query({
	args: { kind: v.string() },
	handler: async (ctx, args) => {
		const cleaned = String(args.kind || "").trim();
		if (!cleaned) throw new Error("kind is required");
		const row = await ctx.db
			.query("messageTemplates")
			.withIndex("by_kind", (q) => q.eq("kind", cleaned))
			.first();
		const texts = (row as any)?.texts;
		if (!Array.isArray(texts)) return [];
		return texts.map((t: any) => String(t)).filter((t: string) => t.trim());
	},
});

export const upsert = mutation({
	args: { kind: v.string(), texts: v.array(v.string()) },
	handler: async (ctx, args) => {
		const cleanedKind = String(args.kind || "").trim();
		if (!cleanedKind) throw new Error("kind is required");
		const cleanedTexts = (args.texts || []).map((t) => String(t)).filter((t) => t.trim());
		const existing = await ctx.db
			.query("messageTemplates")
			.withIndex("by_kind", (q) => q.eq("kind", cleanedKind))
			.first();
		const now = Date.now();
		if (existing) {
			await ctx.db.patch(existing._id, { texts: cleanedTexts, updatedAt: now });
			return true;
		}
		await ctx.db.insert("messageTemplates", {
			kind: cleanedKind,
			texts: cleanedTexts,
			createdAt: now,
			updatedAt: now,
		});
		return true;
	},
});

