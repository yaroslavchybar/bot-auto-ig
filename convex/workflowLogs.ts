import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const levelValidator = v.union(
	v.literal("info"),
	v.literal("warn"),
	v.literal("error"),
	v.literal("success"),
	v.literal("debug")
);

export const list = query({
	args: {
		workflowId: v.id("workflows"),
		limit: v.optional(v.number()),
		level: v.optional(levelValidator),
	},
	handler: async (ctx, args) => {
		const limit = args.limit ?? 100;

		const logs = await ctx.db
			.query("workflowLogs")
			.withIndex("by_workflowId_timestamp", (q) => q.eq("workflowId", args.workflowId))
			.order("desc")
			.take(limit);

		// Filter by level if provided
		const filtered = args.level
			? logs.filter((log) => log.level === args.level)
			: logs;

		return filtered;
	},
});

export const create = mutation({
	args: {
		workflowId: v.id("workflows"),
		nodeId: v.optional(v.string()),
		level: levelValidator,
		message: v.string(),
		metadata: v.optional(v.any()),
	},
	handler: async (ctx, args) => {
		// Verify workflow exists
		const workflow = await ctx.db.get(args.workflowId);
		if (!workflow) throw new Error("Workflow not found");

		const id = await ctx.db.insert("workflowLogs", {
			workflowId: args.workflowId,
			nodeId: args.nodeId,
			level: args.level,
			message: args.message,
			metadata: args.metadata,
			timestamp: Date.now(),
		});
		return await ctx.db.get(id);
	},
});

export const createBatch = mutation({
	args: {
		logs: v.array(
			v.object({
				workflowId: v.id("workflows"),
				nodeId: v.optional(v.string()),
				level: levelValidator,
				message: v.string(),
				metadata: v.optional(v.any()),
			})
		),
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		const ids = await Promise.all(
			args.logs.map((log, idx) =>
				ctx.db.insert("workflowLogs", {
					workflowId: log.workflowId,
					nodeId: log.nodeId,
					level: log.level,
					message: log.message,
					metadata: log.metadata,
					timestamp: now + idx, // Ensure unique timestamps for ordering
				})
			)
		);
		return ids;
	},
});

export const clearForWorkflow = mutation({
	args: { workflowId: v.id("workflows") },
	handler: async (ctx, args) => {
		const logs = await ctx.db
			.query("workflowLogs")
			.withIndex("by_workflowId", (q) => q.eq("workflowId", args.workflowId))
			.collect();

		await Promise.all(logs.map((log) => ctx.db.delete(log._id)));
		return logs.length;
	},
});

export const getRecent = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const limit = args.limit ?? 50;

		const logs = await ctx.db
			.query("workflowLogs")
			.withIndex("by_timestamp")
			.order("desc")
			.take(limit);

		return logs;
	},
});

export const getErrors = query({
	args: { workflowId: v.optional(v.id("workflows")), limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const limit = args.limit ?? 50;

		let logs;
		if (args.workflowId) {
			logs = await ctx.db
				.query("workflowLogs")
				.withIndex("by_workflowId_timestamp", (q) => q.eq("workflowId", args.workflowId!))
				.order("desc")
				.collect();
		} else {
			logs = await ctx.db
				.query("workflowLogs")
				.withIndex("by_timestamp")
				.order("desc")
				.collect();
		}

		return logs.filter((log) => log.level === "error").slice(0, limit);
	},
});
