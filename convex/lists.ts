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
	args: { name: v.string(), fullName: v.optional(v.string()), fullNames: v.optional(v.array(v.string())), usernames: v.optional(v.array(v.string())) },
	handler: async (ctx, args) => {
		const cleaned = String(args.name || "").trim();
		if (!cleaned) throw new DomainError('VALIDATION', "name is required");
		const id = await ctx.db.insert("lists", { name: cleaned, fullName: args.fullName?.trim(), fullNames: cleanFullNames(args.fullNames), usernames: cleanUsernames(args.usernames), createdAt: Date.now() });
		return await ctx.db.get(id);
	},
});

export const update = mutation({
	args: { id: v.id("lists"), name: v.string(), fullName: v.optional(v.string()), fullNames: v.optional(v.array(v.string())), usernames: v.optional(v.array(v.string())) },
	handler: async (ctx, args) => {
		const cleaned = String(args.name || "").trim();
		if (!cleaned) throw new DomainError('VALIDATION', "name is required");
		await ctx.db.patch(args.id, { name: cleaned, ...(args.fullName !== undefined ? { fullName: args.fullName.trim() } : {}), ...(args.fullNames !== undefined ? { fullNames: cleanFullNames(args.fullNames) } : {}), ...(args.usernames !== undefined ? { usernames: cleanUsernames(args.usernames) } : {}) });
		return await ctx.db.get(args.id);
	},
});

function cleanUsernames(input: string[] | undefined): string[] {
  const names = (input ?? []).map(name => name.trim().replace(/^@/, '').toLowerCase());
  if (names.some(name => !/^[a-z0-9._]{1,30}$/.test(name))) throw new DomainError('VALIDATION', 'Invalid Instagram username');
  return [...new Set(names)];
}

function cleanFullNames(input: string[] | undefined): string[] {
  const names = (input ?? []).map(name => name.trim()).filter(Boolean);
  if (names.some(name => !/^[\p{L} .'-]{3,80}$/u.test(name)))
    throw new DomainError('VALIDATION', 'Full names must be 3–80 letters or name punctuation');
  return [...new Set(names)];
}

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
					outreachReady: false,
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
		for (const state of await ctx.db.query('modelSetupStates')
			.withIndex('by_model', q => q.eq('modelId', args.id)).collect()) {
			await ctx.db.delete(state._id);
		}
		for (const group of await ctx.db.query('modelSetupGroupNames')
			.withIndex('by_model_group', q => q.eq('modelId', args.id)).collect()) {
			await ctx.db.delete(group._id);
		}
		await ctx.db.delete(args.id);
		return true;
	},
});
