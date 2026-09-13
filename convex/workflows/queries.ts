import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { query } from "../_generated/server";
import { statusValidator, type WorkflowStatus } from "./helpers";

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
	return rows;
}

async function getWorkflow(ctx: any, args: { id: any }) {
	return await ctx.db.get(args.id);
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
	args: { id: v.id("workflows") },
	handler: getWorkflow,
});

export const getInternal = internalQuery({
	args: { id: v.id("workflows") },
	handler: getWorkflow,
});
