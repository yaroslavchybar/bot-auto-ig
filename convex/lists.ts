import { DomainError } from './errors';
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
		if (!cleaned) throw new DomainError('VALIDATION', "name is required");
		const id = await ctx.db.insert("lists", { name: cleaned, createdAt: Date.now() });
		return await ctx.db.get(id);
	},
});

export const update = mutation({
	args: { id: v.id("lists"), name: v.string() },
	handler: async (ctx, args) => {
		const cleaned = String(args.name || "").trim();
		if (!cleaned) throw new DomainError('VALIDATION', "name is required");
		await ctx.db.patch(args.id, { name: cleaned });
		return await ctx.db.get(args.id);
	},
});

export const remove = mutation({
	args: { id: v.id("lists") },
	handler: async (ctx, args) => {
		const profiles = await ctx.db.query("profiles").collect();
		const automations = await ctx.db.query("automations").collect();
		const impacted = profiles.filter((profile: any) => {
			const listIds = Array.isArray(profile.listIds) ? profile.listIds : [];
			return listIds.some((listId: any) => String(listId) === String(args.id));
		});
		const impactedAutomations = automations.filter((automation: any) => {
			const listIds = Array.isArray(automation.listIds) ? automation.listIds : [];
			return listIds.some((listId: any) => String(listId) === String(args.id));
		});
		await Promise.all(
			impacted.map((profile: any) => {
				const listIds = Array.isArray(profile.listIds) ? profile.listIds : [];
				const nextListIds = listIds.filter((listId: any) => String(listId) !== String(args.id));
				return ctx.db.patch(profile._id, {
					listIds: nextListIds,
				});
			}),
		);
		// Keep the indexed membership table in sync — otherwise orphan rows diverge.
		for (const row of await ctx.db
			.query("profileListAssignments")
			.withIndex("by_list", (q: any) => q.eq("listId", args.id))
			.collect()) {
			await ctx.db.delete(row._id);
		}
		await Promise.all(
			impactedAutomations.map((automation: any) => {
				const listIds = Array.isArray(automation.listIds) ? automation.listIds : [];
				const nextListIds = listIds.filter((listId: any) => String(listId) !== String(args.id));
				return ctx.db.patch(automation._id, {
					listIds: nextListIds,
				});
			}),
		);
		await ctx.db.delete(args.id);
		return true;
	},
});
