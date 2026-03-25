import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { mutation } from "../auth";
import {
	statusValidator,
	normalizeListIds,
	getWorkflowListIds,
	isNewDay,
	assertValidStatusTransition,
	type WorkflowStatus,
} from "./helpers";

export const create = mutation({
	args: {
		name: v.string(),
		description: v.optional(v.string()),
		nodes: v.any(),
		edges: v.any(),
		listIds: v.optional(v.array(v.id("lists"))),
	},
	handler: async (ctx, args) => {
		const cleaned = String(args.name || "").trim();
		if (!cleaned) throw new Error("name is required");

		const now = Date.now();
		const id = await ctx.db.insert("workflows", {
			name: cleaned,
			description: args.description,
			nodes: args.nodes || [],
			edges: args.edges || [],
			listIds: normalizeListIds(args.listIds),
			status: "idle",
			createdAt: now,
			updatedAt: now,
		});
		return await ctx.db.get(id);
	},
});

export const update = mutation({
	args: {
		id: v.id("workflows"),
		name: v.optional(v.string()),
		description: v.optional(v.string()),
		nodes: v.optional(v.any()),
		edges: v.optional(v.any()),
		listIds: v.optional(v.array(v.id("lists"))),
		scheduledAt: v.optional(v.number()),
		maxRetries: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const { id, ...updates } = args;
		const existing = await ctx.db.get(id);
		if (!existing) throw new Error("Workflow not found");

		// Can only update idle/pending workflows (not running)
		if (existing.status === "running") {
			throw new Error("Cannot update running workflow");
		}

		const patch: Record<string, any> = { updatedAt: Date.now() };

		if (updates.name !== undefined) {
			const cleaned = String(updates.name || "").trim();
			if (!cleaned) throw new Error("name cannot be empty");
			patch.name = cleaned;
		}
		if (updates.description !== undefined) patch.description = updates.description;
		if (updates.nodes !== undefined) patch.nodes = updates.nodes;
		if (updates.edges !== undefined) patch.edges = updates.edges;
		if (updates.listIds !== undefined) patch.listIds = normalizeListIds(updates.listIds);
		if (updates.scheduledAt !== undefined) patch.scheduledAt = updates.scheduledAt;
		if (updates.maxRetries !== undefined) patch.maxRetries = updates.maxRetries;

		await ctx.db.patch(id, patch);
		return await ctx.db.get(id);
	},
});

export const remove = mutation({
	args: { id: v.id("workflows") },
	handler: async (ctx, args) => {
		const workflow = await ctx.db.get(args.id);
		if (!workflow) throw new Error("Workflow not found");

		// Can't delete running workflows
		if (workflow.status === "running") {
			throw new Error("Cannot delete running workflow");
		}

		const artifacts = await ctx.db
			.query("workflowArtifacts")
			.withIndex("by_workflowId", (q: any) => q.eq("workflowId", args.id))
			.collect();
		for (const artifact of artifacts) {
			const storageIds = new Set<string>();
			for (const candidate of [artifact.storageId, artifact.exportStorageId, artifact.manifestStorageId]) {
				if (!candidate) continue;
				const key = String(candidate || "").trim();
				if (!key || storageIds.has(key)) continue;
				storageIds.add(key);
				try {
					await ctx.storage.delete(candidate);
				} catch (error: any) {
					const message = String(error?.message || error || "").toLowerCase();
					if (!message.includes("not found")) {
						throw error;
					}
				}
			}
			await ctx.db.delete(artifact._id);
		}

		await ctx.db.delete(args.id);
		return true;
	},
});

export const duplicate = mutation({
	args: {
		id: v.id("workflows"),
		newName: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db.get(args.id);
		if (!existing) throw new Error("Workflow not found");

		const now = Date.now();
		const name = args.newName?.trim() || `${existing.name} (copy)`;

		const newId = await ctx.db.insert("workflows", {
			name,
			description: existing.description,
			nodes: existing.nodes,
			edges: existing.edges,
			listIds: getWorkflowListIds(existing),
			status: "idle",
			createdAt: now,
			updatedAt: now,
		});
		return await ctx.db.get(newId);
	},
});

// ═══════════════════════════════════════════════════════════════════
// EXECUTION MUTATIONS
// ═══════════════════════════════════════════════════════════════════

async function startWorkflow(ctx: any, args: { id: any }) {
	const workflow = await ctx.db.get(args.id);
	if (!workflow) throw new Error("Workflow not found");

	if (workflow.status === "running") {
		throw new Error("Workflow is already running");
	}

	// If already pending (e.g., scheduled run already set it), just return
	if (workflow.status === "pending") {
		return workflow;
	}

	// Reset counter if last run was a different day
	const runsToday = isNewDay(workflow.lastRunAt) ? 0 : (workflow.runsToday ?? 0);

	// Check daily limit
	const maxRuns = workflow.maxRunsPerDay ?? 0;
	if (maxRuns > 0 && runsToday >= maxRuns) {
		throw new Error("Daily run limit reached");
	}

	await ctx.db.patch(args.id, {
		status: "pending",
		runsToday: runsToday + 1,
		lastRunAt: Date.now(),
		error: undefined,
		currentNodeId: undefined,
		startedAt: undefined,
		completedAt: undefined,
		updatedAt: Date.now(),
	});
	return await ctx.db.get(args.id);
}

type UpdateStatusArgs = {
	id: any;
	status: WorkflowStatus;
	currentNodeId?: string;
	nodeStates?: any;
	error?: string;
};

async function updateWorkflowStatus(ctx: any, args: UpdateStatusArgs) {
	const existing = await ctx.db.get(args.id);
	if (!existing) throw new Error("Workflow not found");
	assertValidStatusTransition(existing.status as WorkflowStatus | undefined, args.status as WorkflowStatus);

	const patch: Record<string, any> = {
		status: args.status,
		updatedAt: Date.now(),
	};

	if (args.currentNodeId !== undefined) patch.currentNodeId = args.currentNodeId;
	if (args.nodeStates !== undefined) patch.nodeStates = args.nodeStates;
	if (args.error !== undefined) patch.error = args.error;

	// Set timestamps based on status
	if (args.status === "running" && !existing.startedAt) {
		patch.startedAt = Date.now();
	}
	if (args.status === "completed" || args.status === "failed" || args.status === "cancelled") {
		patch.completedAt = Date.now();
	}

	await ctx.db.patch(args.id, patch);
	return await ctx.db.get(args.id);
}

export const start = mutation({
	args: { id: v.id("workflows") },
	handler: startWorkflow,
});

export const startInternal = internalMutation({
	args: { id: v.id("workflows") },
	handler: startWorkflow,
});

export const updateStatus = mutation({
	args: {
		id: v.id("workflows"),
		status: statusValidator,
		currentNodeId: v.optional(v.string()),
		nodeStates: v.optional(v.any()),
		error: v.optional(v.string()),
	},
	handler: updateWorkflowStatus,
});

export const updateStatusInternal = internalMutation({
	args: {
		id: v.id("workflows"),
		status: statusValidator,
		currentNodeId: v.optional(v.string()),
		nodeStates: v.optional(v.any()),
		error: v.optional(v.string()),
	},
	handler: updateWorkflowStatus,
});

export const pause = mutation({
	args: { id: v.id("workflows") },
	handler: async (ctx, args) => {
		const workflow = await ctx.db.get(args.id);
		if (!workflow) throw new Error("Workflow not found");

		if (workflow.status !== "running") {
			throw new Error("Can only pause running workflows");
		}

		await ctx.db.patch(args.id, {
			status: "paused",
			updatedAt: Date.now(),
		});
		return await ctx.db.get(args.id);
	},
});

export const resume = mutation({
	args: { id: v.id("workflows") },
	handler: async (ctx, args) => {
		const workflow = await ctx.db.get(args.id);
		if (!workflow) throw new Error("Workflow not found");

		if (workflow.status !== "paused") {
			throw new Error("Can only resume paused workflows");
		}

		await ctx.db.patch(args.id, {
			status: "running",
			updatedAt: Date.now(),
		});
		return await ctx.db.get(args.id);
	},
});

export const cancel = mutation({
	args: { id: v.id("workflows") },
	handler: async (ctx, args) => {
		const workflow = await ctx.db.get(args.id);
		if (!workflow) throw new Error("Workflow not found");

		if (workflow.status === "completed" || workflow.status === "cancelled") {
			throw new Error("Workflow already finished");
		}

		await ctx.db.patch(args.id, {
			status: "cancelled",
			completedAt: Date.now(),
			updatedAt: Date.now(),
		});
		return await ctx.db.get(args.id);
	},
});

export const retry = mutation({
	args: { id: v.id("workflows") },
	handler: async (ctx, args) => {
		const workflow = await ctx.db.get(args.id);
		if (!workflow) throw new Error("Workflow not found");

		if (workflow.status !== "failed") {
			throw new Error("Can only retry failed workflows");
		}

		const maxRetries = workflow.maxRetries ?? 0;
		const retryCount = (workflow.retryCount ?? 0) + 1;

		if (maxRetries > 0 && retryCount > maxRetries) {
			throw new Error("Maximum retries exceeded");
		}

		await ctx.db.patch(args.id, {
			status: "pending",
			retryCount,
			error: undefined,
			currentNodeId: undefined,
			completedAt: undefined,
			updatedAt: Date.now(),
		});
		return await ctx.db.get(args.id);
	},
});

export const reset = mutation({
	args: { id: v.id("workflows") },
	handler: async (ctx, args) => {
		const workflow = await ctx.db.get(args.id);
		if (!workflow) throw new Error("Workflow not found");

		if (workflow.status === "running") {
			throw new Error("Cannot reset running workflow");
		}

		await ctx.db.patch(args.id, {
			status: "idle",
			error: undefined,
			currentNodeId: undefined,
			nodeStates: undefined,
			startedAt: undefined,
			completedAt: undefined,
			retryCount: 0,
			updatedAt: Date.now(),
		});
		return await ctx.db.get(args.id);
	},
});
