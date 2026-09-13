import { DomainError } from '../errors';
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { mutation } from "../_generated/server";
import {
	statusValidator,
	normalizeListIds,
	getWorkflowListIds,
	prepareWorkflowRun,
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
		if (!cleaned) throw new DomainError('VALIDATION', "name is required");

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
		maxRetries: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const { id, ...updates } = args;
		const existing = await ctx.db.get(id);
		if (!existing) throw new DomainError('NOT_FOUND', "Workflow not found");

		// Can only update idle/pending workflows (not running)
		if (existing.status === "running") {
			throw new DomainError('CONFLICT', "Cannot update running workflow");
		}

		const patch: Record<string, any> = { updatedAt: Date.now() };

		if (updates.name !== undefined) {
			const cleaned = String(updates.name || "").trim();
			if (!cleaned) throw new DomainError('VALIDATION', "name cannot be empty");
			patch.name = cleaned;
		}
		if (updates.description !== undefined) patch.description = updates.description;
		if (updates.nodes !== undefined) patch.nodes = updates.nodes;
		if (updates.edges !== undefined) patch.edges = updates.edges;
		if (updates.listIds !== undefined) patch.listIds = normalizeListIds(updates.listIds);
		if (updates.maxRetries !== undefined) patch.maxRetries = updates.maxRetries;

		await ctx.db.patch(id, patch);
		return await ctx.db.get(id);
	},
});

export const remove = mutation({
	args: { id: v.id("workflows") },
	handler: async (ctx, args) => {
		const workflow = await ctx.db.get(args.id);
		if (!workflow) throw new DomainError('NOT_FOUND', "Workflow not found");

		// Can't delete running workflows
		if (workflow.status === "running") {
			throw new DomainError('CONFLICT', "Cannot delete running workflow");
		}

		const artifacts = await ctx.db
			.query("workflowArtifacts")
			.withIndex("by_workflowId", (q: any) => q.eq("workflowId", args.id))
			.collect();
		for (const artifact of artifacts) {
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
		if (!existing) throw new DomainError('NOT_FOUND', "Workflow not found");

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
	if (!workflow) throw new DomainError('NOT_FOUND', "Workflow not found");

	if (workflow.status === "running") {
		throw new DomainError('CONFLICT', "Workflow is already running");
	}

	// If already pending (e.g., scheduled run already set it), just return
	if (workflow.status === "pending") {
		return workflow;
	}

	return await prepareWorkflowRun(ctx, workflow);
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
	if (!existing) throw new DomainError('NOT_FOUND', "Workflow not found");
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

export const startInternal = internalMutation({
	args: { id: v.id("workflows") },
	handler: startWorkflow,
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

export const reset = mutation({
	args: { id: v.id("workflows") },
	handler: async (ctx, args) => {
		const workflow = await ctx.db.get(args.id);
		if (!workflow) throw new DomainError('NOT_FOUND', "Workflow not found");

		if (workflow.status === "running") {
			throw new DomainError('CONFLICT', "Cannot reset running workflow");
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

export const reconcileInterruptedInternal = internalMutation({
  args: {},
  handler: async ctx => {
    const running = await ctx.db.query('workflows').withIndex('by_status', q => q.eq('status', 'running')).collect();
    const pending = await ctx.db.query('workflows').withIndex('by_status', q => q.eq('status', 'pending')).collect();
    const interrupted = [...running, ...pending];
    for (const workflow of interrupted) {
      await ctx.db.patch(workflow._id, { status: 'failed', error: 'Server restarted during execution', completedAt: Date.now(), updatedAt: Date.now() });
    }
    return { reconciled: interrupted.length };
  },
});
