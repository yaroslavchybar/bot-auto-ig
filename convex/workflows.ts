import { v } from "convex/values";
import { internalMutation, internalAction } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { Crons } from "@convex-dev/crons";
import { mutation, query } from "./auth";

const crons = new Crons(components.crons);

// Check if lastRunAt is from a previous UTC day
function isNewDay(lastRunAt?: number): boolean {
	if (!lastRunAt) return true;
	const lastDate = new Date(lastRunAt).toISOString().slice(0, 10);
	const today = new Date().toISOString().slice(0, 10);
	return lastDate !== today;
}

// Schedule type for building cron expressions
type ScheduleType = "interval" | "daily" | "weekly" | "monthly" | "cron" | "instant";
type ScheduleConfig = {
	intervalMs?: number;
	hourUTC?: number;
	minuteUTC?: number;
	daysOfWeek?: number[];
	dayOfMonth?: number;
	cronspec?: string;
};
type WorkflowStatus = "idle" | "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";

function requireIntegerInRange(value: number | undefined, field: string, min: number, max: number): number {
	if (!Number.isInteger(value) || value! < min || value! > max) {
		throw new Error(`${field} must be an integer between ${min} and ${max}`);
	}
	return value!;
}

function hasDefinedScheduleConfigValues(config: ScheduleConfig): boolean {
	return Object.values(config).some((value) => value !== undefined);
}

function validateScheduleConfig(scheduleType: ScheduleType, config: ScheduleConfig) {
	switch (scheduleType) {
		case "instant":
			if (hasDefinedScheduleConfigValues(config)) {
				throw new Error("Instant workflows do not accept scheduleConfig values");
			}
			return;
		case "interval":
			if (!Number.isInteger(config.intervalMs) || (config.intervalMs ?? 0) <= 0) {
				throw new Error("intervalMs must be a positive integer");
			}
			return;
		case "daily":
			requireIntegerInRange(config.hourUTC, "hourUTC", 0, 23);
			requireIntegerInRange(config.minuteUTC, "minuteUTC", 0, 59);
			return;
		case "weekly": {
			requireIntegerInRange(config.hourUTC, "hourUTC", 0, 23);
			requireIntegerInRange(config.minuteUTC, "minuteUTC", 0, 59);
			if (!Array.isArray(config.daysOfWeek) || config.daysOfWeek.length === 0) {
				throw new Error("daysOfWeek must contain at least one day");
			}
			for (const day of config.daysOfWeek) {
				requireIntegerInRange(day, "daysOfWeek", 0, 6);
			}
			return;
		}
		case "monthly":
			requireIntegerInRange(config.hourUTC, "hourUTC", 0, 23);
			requireIntegerInRange(config.minuteUTC, "minuteUTC", 0, 59);
			requireIntegerInRange(config.dayOfMonth, "dayOfMonth", 1, 31);
			return;
		case "cron":
			if (!String(config.cronspec ?? "").trim()) {
				throw new Error("cronspec is required");
			}
			return;
	}
}

function assertValidStatusTransition(currentStatus: WorkflowStatus | undefined, nextStatus: WorkflowStatus) {
	const current = currentStatus ?? "idle";
	const allowedTransitions: Record<WorkflowStatus, WorkflowStatus[]> = {
		idle: ["idle", "pending"],
		pending: ["pending", "running", "completed", "failed", "cancelled"],
		running: ["running", "paused", "completed", "failed", "cancelled"],
		paused: ["paused", "running", "failed", "cancelled"],
		completed: ["completed"],
		failed: ["failed"],
		cancelled: ["cancelled"],
	};

	if (!allowedTransitions[current].includes(nextStatus)) {
		throw new Error(`Illegal workflow status transition from ${current} to ${nextStatus}; use reset or retry`);
	}
}

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

function normalizeListIds(listIds: any[] | undefined): any[] {
	const raw = Array.isArray(listIds) ? listIds : [];
	const seen = new Set<string>();
	const deduped: any[] = [];
	for (const id of raw) {
		const key = String(id || "").trim();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		deduped.push(id);
	}
	return deduped;
}

function getWorkflowListIds(workflow: any): any[] {
	const raw = Array.isArray(workflow?.listIds) ? workflow.listIds : [];
	return normalizeListIds(raw);
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
		status: v.optional(statusValidator),
	},
	handler: async (ctx, args) => {
		let rows;

		if (args.status) {
			rows = await ctx.db
				.query("workflows")
				.withIndex("by_status", (q) => q.eq("status", args.status!))
				.collect();
		} else {
			rows = await ctx.db.query("workflows").collect();
		}

		rows.sort((a, b) => b.updatedAt - a.updatedAt);
		return rows;
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

// ═══════════════════════════════════════════════════════════════════
// CRUD MUTATIONS
// ═══════════════════════════════════════════════════════════════════

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

export const start = mutation({
	args: { id: v.id("workflows") },
	handler: async (ctx, args) => {
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
			nodeStates: {},
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
		error: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
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

// ═══════════════════════════════════════════════════════════════════
// SCHEDULING MUTATIONS
// ═══════════════════════════════════════════════════════════════════

const scheduleTypeValidator = v.union(
	v.literal("interval"),
	v.literal("daily"),
	v.literal("weekly"),
	v.literal("monthly"),
	v.literal("cron"),
	v.literal("instant")
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
		const scheduleConfig = args.scheduleConfig as ScheduleConfig;
		validateScheduleConfig(args.scheduleType as ScheduleType, scheduleConfig);

		await ctx.db.patch(args.id, {
			scheduleType: args.scheduleType,
			scheduleConfig,
			maxRunsPerDay: args.maxRunsPerDay,
			timezone: args.timezone,
			updatedAt: Date.now(),
		});

		// If already active, update the cron job
		if (workflow.isActive) {
			if (workflow.cronJobId) {
				await crons.delete(ctx, { id: workflow.cronJobId });
			}
			if (args.scheduleType === "instant") {
				// Instant doesn't need a recurring cron — clear cronJobId
				await ctx.db.patch(args.id, { cronJobId: undefined });
			} else {
				// Create new cron
				const schedule = buildCronSchedule(args.scheduleType as ScheduleType, scheduleConfig);
				const cronJobId = await crons.register(
					ctx,
					schedule,
					internal.workflows.executeScheduledWorkflow,
					{ workflowId: args.id },
					`workflow_${args.id}`
				);
				await ctx.db.patch(args.id, { cronJobId });
			}
		}

		return await ctx.db.get(args.id);
	},
});

export const activate = mutation({
	args: { id: v.id("workflows") },
	handler: async (ctx, args) => {
		const workflow = await ctx.db.get(args.id);
		if (!workflow) throw new Error("Workflow not found");
		if (workflow.isActive) throw new Error("Workflow is already active");

		// Require schedule to be configured
		if (!workflow.scheduleType) {
			throw new Error("Please configure a schedule before activating");
		}

		const scheduleConfig = (workflow.scheduleConfig ?? {}) as ScheduleConfig;
		validateScheduleConfig(workflow.scheduleType as ScheduleType, scheduleConfig);

		if (workflow.scheduleType === "instant") {
			await ctx.db.patch(args.id, {
				isActive: true,
				cronJobId: undefined,
				updatedAt: Date.now(),
			});
			await ctx.scheduler.runAfter(0, internal.workflows.executeScheduledWorkflow, {
				workflowId: args.id,
			});
		} else {
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
				updatedAt: Date.now(),
			});
		}

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
			validateScheduleConfig(workflow.scheduleType as ScheduleType, scheduleConfig);

			if (workflow.scheduleType === "instant") {
				// Instant run: trigger immediately, no cron job
				await ctx.db.patch(args.id, {
					isActive: true,
					cronJobId: undefined,
					updatedAt: Date.now(),
				});
				// Trigger immediate execution
				await ctx.scheduler.runAfter(0, internal.workflows.executeScheduledWorkflow, {
					workflowId: args.id,
				});
			} else {
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
					updatedAt: Date.now(),
				});
			}
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

		// Reset counter if last run was a different day
		const runsToday = isNewDay(workflow.lastRunAt) ? 0 : (workflow.runsToday ?? 0);

		// Check daily limit
		const maxRuns = workflow.maxRunsPerDay ?? 0;
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

export const migrateLegacyListIdToListIds = internalMutation({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query("workflows").collect();
		let migrated = 0;
		for (const row of rows) {
			const doc = row as any;
			if (Array.isArray(doc.listIds)) continue;
			const legacyListId = doc.listId;
			const listIds = legacyListId ? [legacyListId] : [];
			await ctx.db.patch(row._id, { listIds } as any);
			migrated++;
		}
		return { migrated };
	},
});

export const cleanupLegacyListIdField = internalMutation({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query("workflows").collect();
		let cleaned = 0;
		for (const row of rows) {
			const doc = row as any;
			if (!("listId" in doc)) continue;
			await ctx.db.patch(row._id, { listId: undefined } as any);
			cleaned++;
		}
		return { cleaned };
	},
});
