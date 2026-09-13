import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { query } from "../_generated/server";
import { statusValidator, isNewDay, type WorkflowStatus } from "./helpers";

async function listWorkflows(ctx: any, args: { status?: WorkflowStatus }) {
	let rows;

	if (args.status) {
		rows = await ctx.db
			.query("workflows")
			.withIndex("by_status", (q: any) => q.eq("status", args.status!))
			.collect();
	} else {
		rows = await ctx.db.query("workflows").collect();
	}

	rows.sort((a: any, b: any) => b.updatedAt - a.updatedAt);
	return rows.map((row: any) => ({ ...row, runsToday: isNewDay(row.lastRunAt) ? 0 : (row.runsToday ?? 0) }));
}

async function getWorkflow(ctx: any, args: { id: string }) {
	const normalized = ctx.db.normalizeId("workflows", args.id);
	if (!normalized) return null;
	return await ctx.db.get(normalized);
}

export const list = query({
	args: {
		status: v.optional(statusValidator),
	},
	handler: listWorkflows,
});

export const listInternal = internalQuery({
	args: {
		status: v.optional(statusValidator),
	},
	handler: listWorkflows,
});

export const get = query({
	args: { id: v.string() },
	handler: getWorkflow,
});

export const getInternal = internalQuery({
	args: { id: v.string() },
	handler: getWorkflow,
});
