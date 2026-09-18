import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { query } from "../_generated/server";
import { statusValidator, type AutomationStatus } from "./helpers";

async function listAutomations(ctx: any, args: { status?: AutomationStatus }) {
	let rows;

	if (args.status) {
		rows = await ctx.db
			.query("automations")
			.withIndex("by_status", (q: any) => q.eq("status", args.status!))
			.collect();
	} else {
		rows = await ctx.db.query("automations").collect();
	}

	rows.sort((a: any, b: any) => b.updatedAt - a.updatedAt);
	return rows;
}

async function getAutomation(ctx: any, args: { id: string }) {
	const normalized = ctx.db.normalizeId("automations", args.id);
	if (!normalized) return null;
	return await ctx.db.get(normalized);
}

export const list = query({
	args: {
		status: v.optional(statusValidator),
	},
	handler: listAutomations,
});

export const listInternal = internalQuery({
	args: {
		status: v.optional(statusValidator),
	},
	handler: listAutomations,
});

export const get = query({
	args: { id: v.string() },
	handler: getAutomation,
});

export const getInternal = internalQuery({
	args: { id: v.string() },
	handler: getAutomation,
});
