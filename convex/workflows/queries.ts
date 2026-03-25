import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { query } from "../auth";
import { statusValidator, getWorkflowListIds, type WorkflowStatus } from "./helpers";

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

export const getQueue = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const limit = args.limit ?? 10;

		const pending = await ctx.db
			.query("workflows")
			.withIndex("by_status", (q) => q.eq("status", "pending"))
			.collect();

		const running = await ctx.db
			.query("workflows")
			.withIndex("by_status", (q) => q.eq("status", "running"))
			.collect();

		const all = [...running, ...pending];
		all.sort((a, b) => b.updatedAt - a.updatedAt);

		return all.slice(0, limit);
	},
});

export const getByList = query({
	args: { listId: v.id("lists") },
	handler: async (ctx, args) => {
		const rows = await ctx.db.query("workflows").collect();
		return rows.filter((row: any) => {
			const listIds = getWorkflowListIds(row);
			return listIds.some((listId) => String(listId) === String(args.listId));
		});
	},
});
