import { v } from "convex/values";
import { internalMutation, internalAction } from "../_generated/server";
import { components, internal } from "../_generated/api";
import { Crons } from "@convex-dev/crons";
import { mutation } from "../_generated/server";
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
			nodeStates: undefined,
			lastRunAt: Date.now(),
			error: undefined,
			currentNodeId: undefined,
			startedAt: undefined,
			completedAt: undefined,
			updatedAt: Date.now(),
		});

		// Schedule the HTTP call to trigger the Bun worker
		await ctx.scheduler.runAfter(0, internal.workflows.scheduling.triggerWorkflowExecution, {
			workflowId: args.workflowId,
		});

		return { success: true };
	},
});

// Internal action to call the server and trigger TypeScript execution
export const triggerWorkflowExecution = internalAction({
	args: { workflowId: v.id("workflows") },
	handler: async (_ctx, args) => {
		const rawServerUrl = (globalThis as any)?.process?.env?.SERVER_URL as string | undefined;
		const rawApiKey = (globalThis as any)?.process?.env?.INTERNAL_API_KEY as string | undefined;

		// Normalize base URL (trim whitespace, drop trailing slashes).
		const serverUrl = (typeof rawServerUrl === "string" ? rawServerUrl.trim() : "") || "http://localhost:5000";
		const normalizedServerUrl = serverUrl.replace(/\/+$/, "");
		// Trim pasted secrets (trailing newline/space breaks undici fetch
		// with "failed to parse header value").
		const apiKey = typeof rawApiKey === "string" ? rawApiKey.trim() : "";

		if (!apiKey) {
			console.error("Cannot trigger workflow: INTERNAL_API_KEY is not configured in Convex env");
			return { success: false, error: "INTERNAL_API_KEY is not configured in Convex env" };
		}
		if (/[\r\n\0]/.test(apiKey) || /[^\x20-\x7E]/.test(apiKey)) {
			console.error("Cannot trigger workflow: INTERNAL_API_KEY contains invalid characters (newline or non-ASCII). Re-set it without quotes/newlines.");
			return { success: false, error: "INTERNAL_API_KEY contains invalid characters" };
		}

		try {
			const response = await fetch(`${normalizedServerUrl}/api/workflows/run`, {
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
