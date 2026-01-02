import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query("lists").collect();
		rows.sort((a, b) => a.createdAt - b.createdAt);
		return rows;
	},
});

export const create = mutation({
	args: { name: v.string() },
	handler: async (ctx, args) => {
		const cleaned = String(args.name || "").trim();
		if (!cleaned) throw new Error("name is required");
		const id = await ctx.db.insert("lists", { name: cleaned, createdAt: Date.now() });
		return await ctx.db.get(id);
	},
});

export const update = mutation({
	args: { id: v.id("lists"), name: v.string() },
	handler: async (ctx, args) => {
		const cleaned = String(args.name || "").trim();
		if (!cleaned) throw new Error("name is required");
		await ctx.db.patch(args.id, { name: cleaned });
		return await ctx.db.get(args.id);
	},
});

export const remove = mutation({
	args: { id: v.id("lists") },
	handler: async (ctx, args) => {
		const profiles = await ctx.db
			.query("profiles")
			.withIndex("by_listId", (q) => q.eq("listId", args.id))
			.collect();
		await Promise.all(profiles.map((p) => ctx.db.patch(p._id, { listId: undefined })));
		await ctx.db.delete(args.id);
		return true;
	},
});

