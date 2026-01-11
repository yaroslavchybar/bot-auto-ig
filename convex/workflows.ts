import { v } from "convex/values";
import { mutation, query, internalMutation, internalAction } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { Crons } from "@convex-dev/crons";

const crons = new Crons(components.crons);

// Schedule type for building cron expressions
type ScheduleType = "interval" | "daily" | "weekly" | "monthly" | "cron";
type ScheduleConfig = {
	intervalMs?: number;
	hourUTC?: number;
	minuteUTC?: number;
	daysOfWeek?: number[];
	dayOfMonth?: number;
	cronspec?: string;
};

function buildCronSchedule(
	scheduleType: ScheduleType,
	config: ScheduleConfig
): { kind: "interval"; ms: number } | { kind: "cron"; cronspec: string } {
	const hour = config.hourUTC ?? 9;
	const minute = config.minuteUTC ?? 0;

	switch (scheduleType) {
		case "interval":
			return { kind: "interval", ms: config.intervalMs ?? 3600000 };
		case "daily":
			return { kind: "cron", cronspec: `${minute} ${hour} * * *` };
		case "weekly": {
			const days = config.daysOfWeek?.length ? config.daysOfWeek.join(",") : "1,2,3,4,5";
			return { kind: "cron", cronspec: `${minute} ${hour} * * ${days}` };
		}
		case "monthly": {
			const day = config.dayOfMonth ?? 1;
			return { kind: "cron", cronspec: `${minute} ${hour} ${day} * *` };
		}
		case "cron":
			return { kind: "cron", cronspec: config.cronspec ?? "0 9 * * *" };
		default:
			return { kind: "cron", cronspec: "0 9 * * *" };
	}
}

const statusValidator = v.union(
	v.literal("idle"),
	v.literal("pending"),
	v.literal("running"),
	v.literal("paused"),
	v.literal("completed"),
	v.literal("failed"),
	v.literal("cancelled")
);

// ═══════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════

export const list = query({
	args: {
		isTemplate: v.optional(v.boolean()),
		category: v.optional(v.string()),
		status: v.optional(statusValidator),
	},
	handler: async (ctx, args) => {
		let rows;

		if (args.isTemplate !== undefined) {
			rows = await ctx.db
				.query("workflows")
				.withIndex("by_isTemplate", (q) => q.eq("isTemplate", args.isTemplate!))
				.collect();
		} else if (args.status) {
			rows = await ctx.db
				.query("workflows")
				.withIndex("by_status", (q) => q.eq("status", args.status!))
				.collect();
		} else {
			rows = await ctx.db.query("workflows").collect();
		}

		// Filter by category if provided
		let filtered = args.category
			? rows.filter((r) => r.category === args.category)
			: rows;

		// Filter by status if provided and we didn't use index
		if (args.status && args.isTemplate !== undefined) {
			filtered = filtered.filter((r) => r.status === args.status);
		}

		filtered.sort((a, b) => b.updatedAt - a.updatedAt);
		return filtered;
	},
});

export const get = query({
	args: { id: v.id("workflows") },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.id);
	},
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
		all.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

		return all.slice(0, limit);
	},
});

export const getByProfile = query({
	args: { profileId: v.id("profiles") },
	handler: async (ctx, args) => {
		return await ctx.db
			.query("workflows")
			.withIndex("by_profileId", (q) => q.eq("profileId", args.profileId))
			.collect();
	},
});

// ═══════════════════════════════════════════════════════════════════
// CRUD MUTATIONS
// ═══════════════════════════════════════════════════════════════════

export const create = mutation({
	args: {
		name: v.string(),
		description: v.optional(v.string()),
		nodes: v.any(),
		edges: v.any(),
		isTemplate: v.boolean(),
		category: v.optional(v.string()),
		profileId: v.optional(v.id("profiles")),
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
			isTemplate: args.isTemplate,
			category: args.category,
			profileId: args.profileId,
			status: args.isTemplate ? undefined : "idle",
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
		isTemplate: v.optional(v.boolean()),
		category: v.optional(v.string()),
		profileId: v.optional(v.id("profiles")),
		priority: v.optional(v.number()),
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
		if (updates.isTemplate !== undefined) patch.isTemplate = updates.isTemplate;
		if (updates.category !== undefined) patch.category = updates.category;
		if (updates.profileId !== undefined) patch.profileId = updates.profileId;
		if (updates.priority !== undefined) patch.priority = updates.priority;
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

		// Delete associated logs
		const logs = await ctx.db
			.query("workflowLogs")
			.withIndex("by_workflowId", (q) => q.eq("workflowId", args.id))
			.collect();
		await Promise.all(logs.map((log) => ctx.db.delete(log._id)));

		await ctx.db.delete(args.id);
		return true;
	},
});

export const duplicate = mutation({
	args: { 
		id: v.id("workflows"), 
		newName: v.optional(v.string()),
		asTemplate: v.optional(v.boolean()),
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db.get(args.id);
		if (!existing) throw new Error("Workflow not found");

		const now = Date.now();
		const name = args.newName?.trim() || `${existing.name} (copy)`;
		const isTemplate = args.asTemplate ?? false;

		const newId = await ctx.db.insert("workflows", {
			name,
			description: existing.description,
			nodes: existing.nodes,
			edges: existing.edges,
			isTemplate,
			category: existing.category,
			status: isTemplate ? undefined : "idle",
			createdAt: now,
			updatedAt: now,
		});
		return await ctx.db.get(newId);
	},
});

// ═══════════════════════════════════════════════════════════════════
// EXECUTION MUTATIONS
// ═══════════════════════════════════════════════════════════════════

export const start = mutation({
	args: { id: v.id("workflows") },
	handler: async (ctx, args) => {
		const workflow = await ctx.db.get(args.id);
		if (!workflow) throw new Error("Workflow not found");

		if (workflow.isTemplate) {
			throw new Error("Cannot run a template directly. Duplicate it first.");
		}

		if (workflow.status === "running") {
			throw new Error("Workflow is already running");
		}

		await ctx.db.patch(args.id, {
			status: "pending",
			error: undefined,
			currentNodeId: undefined,
			nodeStates: {},
			progress: 0,
			startedAt: undefined,
			completedAt: undefined,
			updatedAt: Date.now(),
		});
		return await ctx.db.get(args.id);
	},
});

export const updateStatus = mutation({
	args: {
		id: v.id("workflows"),
		status: statusValidator,
		currentNodeId: v.optional(v.string()),
		nodeStates: v.optional(v.any()),
		progress: v.optional(v.number()),
		error: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db.get(args.id);
		if (!existing) throw new Error("Workflow not found");

		const patch: Record<string, any> = {
			status: args.status,
			updatedAt: Date.now(),
		};

		if (args.currentNodeId !== undefined) patch.currentNodeId = args.currentNodeId;
		if (args.nodeStates !== undefined) patch.nodeStates = args.nodeStates;
		if (args.progress !== undefined) patch.progress = args.progress;
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
	},
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
			progress: 0,
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

		// Clear logs
		const logs = await ctx.db
			.query("workflowLogs")
			.withIndex("by_workflowId", (q) => q.eq("workflowId", args.id))
			.collect();
		await Promise.all(logs.map((log) => ctx.db.delete(log._id)));

		await ctx.db.patch(args.id, {
			status: "idle",
			error: undefined,
			currentNodeId: undefined,
			nodeStates: undefined,
			progress: undefined,
			startedAt: undefined,
			completedAt: undefined,
			retryCount: 0,
			updatedAt: Date.now(),
		});
		return await ctx.db.get(args.id);
	},
});

// ═══════════════════════════════════════════════════════════════════
// SCHEDULING MUTATIONS
// ═══════════════════════════════════════════════════════════════════

const scheduleTypeValidator = v.union(
	v.literal("interval"),
	v.literal("daily"),
	v.literal("weekly"),
	v.literal("monthly"),
	v.literal("cron")
);

const scheduleConfigValidator = v.object({
	intervalMs: v.optional(v.number()),
	hourUTC: v.optional(v.number()),
	minuteUTC: v.optional(v.number()),
	daysOfWeek: v.optional(v.array(v.number())),
	dayOfMonth: v.optional(v.number()),
	cronspec: v.optional(v.string()),
});

export const updateSchedule = mutation({
	args: {
		id: v.id("workflows"),
		scheduleType: scheduleTypeValidator,
		scheduleConfig: scheduleConfigValidator,
		maxRunsPerDay: v.optional(v.number()),
		timezone: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const workflow = await ctx.db.get(args.id);
		if (!workflow) throw new Error("Workflow not found");
		if (workflow.isTemplate) throw new Error("Cannot schedule a template");

		await ctx.db.patch(args.id, {
			scheduleType: args.scheduleType,
			scheduleConfig: args.scheduleConfig,
			maxRunsPerDay: args.maxRunsPerDay,
			timezone: args.timezone,
			updatedAt: Date.now(),
		});

		// If already active, update the cron job
		if (workflow.isActive && workflow.cronJobId) {
			// Delete old cron and create new one
			await crons.delete(ctx, { id: workflow.cronJobId });
			const schedule = buildCronSchedule(args.scheduleType, args.scheduleConfig);
			const cronJobId = await crons.register(
				ctx,
				schedule,
				internal.workflows.executeScheduledWorkflow,
				{ workflowId: args.id },
				`workflow_${args.id}`
			);
			await ctx.db.patch(args.id, { cronJobId });
		}

		return await ctx.db.get(args.id);
	},
});

export const activate = mutation({
	args: { id: v.id("workflows") },
	handler: async (ctx, args) => {
		const workflow = await ctx.db.get(args.id);
		if (!workflow) throw new Error("Workflow not found");
		if (workflow.isTemplate) throw new Error("Cannot activate a template");
		if (workflow.isActive) throw new Error("Workflow is already active");

		// Require schedule to be configured
		if (!workflow.scheduleType) {
			throw new Error("Please configure a schedule before activating");
		}

		const scheduleConfig = (workflow.scheduleConfig ?? {}) as ScheduleConfig;
		const schedule = buildCronSchedule(workflow.scheduleType as ScheduleType, scheduleConfig);

		// Register the cron job
		const cronJobId = await crons.register(
			ctx,
			schedule,
			internal.workflows.executeScheduledWorkflow,
			{ workflowId: args.id },
			`workflow_${args.id}`
		);

		await ctx.db.patch(args.id, {
			isActive: true,
			cronJobId,
			runsToday: 0,
			updatedAt: Date.now(),
		});

		return await ctx.db.get(args.id);
	},
});

export const deactivate = mutation({
	args: { id: v.id("workflows") },
	handler: async (ctx, args) => {
		const workflow = await ctx.db.get(args.id);
		if (!workflow) throw new Error("Workflow not found");
		if (!workflow.isActive) throw new Error("Workflow is not active");

		// Delete the cron job if exists
		if (workflow.cronJobId) {
			try {
				await crons.delete(ctx, { id: workflow.cronJobId });
			} catch {
				// Cron may already be deleted
			}
		}

		await ctx.db.patch(args.id, {
			isActive: false,
			cronJobId: undefined,
			updatedAt: Date.now(),
		});

		return await ctx.db.get(args.id);
	},
});

export const toggleActive = mutation({
	args: { id: v.id("workflows") },
	handler: async (ctx, args) => {
		const workflow = await ctx.db.get(args.id);
		if (!workflow) throw new Error("Workflow not found");
		if (workflow.isTemplate) throw new Error("Cannot toggle a template");

		if (workflow.isActive) {
			// Deactivate
			if (workflow.cronJobId) {
				try {
					await crons.delete(ctx, { id: workflow.cronJobId });
				} catch {
					// Ignore
				}
			}
			await ctx.db.patch(args.id, {
				isActive: false,
				cronJobId: undefined,
				updatedAt: Date.now(),
			});
		} else {
			// Activate
			if (!workflow.scheduleType) {
				throw new Error("Please configure a schedule before activating");
			}
			const scheduleConfig = (workflow.scheduleConfig ?? {}) as ScheduleConfig;
			const schedule = buildCronSchedule(workflow.scheduleType as ScheduleType, scheduleConfig);
			const cronJobId = await crons.register(
				ctx,
				schedule,
				internal.workflows.executeScheduledWorkflow,
				{ workflowId: args.id },
				`workflow_${args.id}`
			);
			await ctx.db.patch(args.id, {
				isActive: true,
				cronJobId,
				runsToday: 0,
				updatedAt: Date.now(),
			});
		}

		return await ctx.db.get(args.id);
	},
});

// Internal mutation called by the cron job
export const executeScheduledWorkflow = internalMutation({
	args: { workflowId: v.id("workflows") },
	handler: async (ctx, args) => {
		const workflow = await ctx.db.get(args.workflowId);
		if (!workflow) return { success: false, error: "Workflow not found" };
		if (!workflow.isActive) return { success: false, error: "Workflow not active" };
		if (workflow.status === "running") return { success: false, error: "Already running" };

		// Check daily limit
		const maxRuns = workflow.maxRunsPerDay ?? 0;
		const runsToday = workflow.runsToday ?? 0;
		if (maxRuns > 0 && runsToday >= maxRuns) {
			return { success: false, error: "Daily limit reached" };
		}

		// Update workflow to trigger execution
		await ctx.db.patch(args.workflowId, {
			status: "pending",
			runsToday: runsToday + 1,
			lastRunAt: Date.now(),
			error: undefined,
			currentNodeId: undefined,
			nodeStates: {},
			progress: 0,
			startedAt: undefined,
			completedAt: undefined,
			updatedAt: Date.now(),
		});

		// Schedule the HTTP call to trigger Python runner
		await ctx.scheduler.runAfter(0, internal.workflows.triggerWorkflowExecution, {
			workflowId: args.workflowId,
		});

		return { success: true };
	},
});

// Internal action to call the server and trigger Python execution
export const triggerWorkflowExecution = internalAction({
	args: { workflowId: v.id("workflows") },
	handler: async (_ctx, args) => {
		const serverUrl = (globalThis as any)?.process?.env?.SERVER_URL || "http://localhost:5000";
		const apiKey = (globalThis as any)?.process?.env?.INTERNAL_API_KEY || "";

		try {
			const response = await fetch(`${serverUrl}/api/workflows/run`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Authorization": `Bearer ${apiKey}`,
				},
				body: JSON.stringify({ workflowId: args.workflowId }),
			});

			if (!response.ok) {
				const text = await response.text();
				console.error("Failed to trigger workflow:", text);
				return { success: false, error: text };
			}

			return { success: true };
		} catch (error) {
			console.error("Error triggering workflow:", error);
			return { success: false, error: String(error) };
		}
	},
});

// Reset runsToday for all active workflows (call from daily cron)
export const resetDailyRuns = internalMutation({
	handler: async (ctx) => {
		const activeWorkflows = await ctx.db
			.query("workflows")
			.withIndex("by_isActive", (q) => q.eq("isActive", true))
			.collect();

		for (const workflow of activeWorkflows) {
			await ctx.db.patch(workflow._id, { 
				runsToday: 0,
			});
		}

		return { reset: activeWorkflows.length };
	},
});
