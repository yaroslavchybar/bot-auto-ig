import { v } from "convex/values";
import { internalMutation, internalAction } from "../_generated/server";
import { components, internal } from "../_generated/api";
import { Crons } from "@convex-dev/crons";
import { mutation } from "../auth";
import {
	scheduleTypeValidator,
	scheduleConfigValidator,
	validateScheduleConfig,
	buildCronSchedule,
	isNewDay,
	type ScheduleType,
	type ScheduleConfig,
} from "./helpers";

const crons = new Crons(components.crons);

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
					internal.workflows.scheduling.executeScheduledWorkflow,
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
			await ctx.scheduler.runAfter(0, internal.workflows.scheduling.executeScheduledWorkflow, {
				workflowId: args.id,
			});
		} else {
			const schedule = buildCronSchedule(workflow.scheduleType as ScheduleType, scheduleConfig);

			// Register the cron job
			const cronJobId = await crons.register(
				ctx,
				schedule,
				internal.workflows.scheduling.executeScheduledWorkflow,
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
				await ctx.scheduler.runAfter(0, internal.workflows.scheduling.executeScheduledWorkflow, {
					workflowId: args.id,
				});
			} else {
				const schedule = buildCronSchedule(workflow.scheduleType as ScheduleType, scheduleConfig);
				const cronJobId = await crons.register(
					ctx,
					schedule,
					internal.workflows.scheduling.executeScheduledWorkflow,
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
			startedAt: undefined,
			completedAt: undefined,
			updatedAt: Date.now(),
		});

		// Schedule the HTTP call to trigger Python runner
		await ctx.scheduler.runAfter(0, internal.workflows.scheduling.triggerWorkflowExecution, {
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
