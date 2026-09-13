import type { MutationCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { DomainError } from '../errors';
import { v } from "convex/values";

// Check if lastRunAt is from a previous UTC day
export function isNewDay(lastRunAt?: number): boolean {
	if (!lastRunAt) return true;
	const lastDate = new Date(lastRunAt).toISOString().slice(0, 10);
	const today = new Date().toISOString().slice(0, 10);
	return lastDate !== today;
}

// Schedule type for building cron expressions
export type ScheduleType = "interval" | "daily" | "weekly" | "monthly" | "cron" | "instant";
export type ScheduleConfig = {
	intervalMs?: number;
	hourUTC?: number;
	minuteUTC?: number;
	daysOfWeek?: number[];
	dayOfMonth?: number;
	cronspec?: string;
};
export type WorkflowStatus = "idle" | "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";

function requireIntegerInRange(value: number | undefined, field: string, min: number, max: number): number {
	if (!Number.isInteger(value) || value! < min || value! > max) {
		throw new Error(`${field} must be an integer between ${min} and ${max}`);
	}
	return value!;
}

function hasDefinedScheduleConfigValues(config: ScheduleConfig): boolean {
	return Object.values(config).some((value) => value !== undefined);
}

export function validateScheduleConfig(scheduleType: ScheduleType, config: ScheduleConfig) {
	switch (scheduleType) {
		case "instant":
			if (hasDefinedScheduleConfigValues(config)) {
				throw new DomainError('VALIDATION', "Instant workflows do not accept scheduleConfig values");
			}
			return;
		case "interval":
			if (!Number.isInteger(config.intervalMs) || (config.intervalMs ?? 0) <= 0) {
				throw new DomainError('VALIDATION', "intervalMs must be a positive integer");
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
				throw new DomainError('VALIDATION', "daysOfWeek must contain at least one day");
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
				throw new DomainError('VALIDATION', "cronspec is required");
			}
			return;
	}
}

export function assertValidStatusTransition(currentStatus: WorkflowStatus | undefined, nextStatus: WorkflowStatus) {
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
		throw new DomainError('CONFLICT', `Illegal workflow status transition from ${current} to ${nextStatus}; use reset or retry`);
	}
}

export function buildCronSchedule(
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

export function normalizeListIds(listIds: any[] | undefined): any[] {
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

export function getWorkflowListIds(workflow: any): any[] {
	const raw = Array.isArray(workflow?.listIds) ? workflow.listIds : [];
	return normalizeListIds(raw);
}

export const statusValidator = v.union(
	v.literal("idle"),
	v.literal("pending"),
	v.literal("running"),
	v.literal("paused"),
	v.literal("completed"),
	v.literal("failed"),
	v.literal("cancelled")
);

export const scheduleTypeValidator = v.union(
	v.literal("interval"),
	v.literal("daily"),
	v.literal("weekly"),
	v.literal("monthly"),
	v.literal("cron"),
	v.literal("instant")
);

export const scheduleConfigValidator = v.object({
	intervalMs: v.optional(v.number()),
	hourUTC: v.optional(v.number()),
	minuteUTC: v.optional(v.number()),
	daysOfWeek: v.optional(v.array(v.number())),
	dayOfMonth: v.optional(v.number()),
	cronspec: v.optional(v.string()),
});

/** Both manual and scheduled runs reserve their daily slot in this transaction. */
export async function prepareWorkflowRun(ctx: MutationCtx, workflow: Doc<'workflows'>) {
  if (workflow.status === 'running' || workflow.status === 'pending') {
    throw new DomainError('CONFLICT', 'Workflow is already running or pending');
  }
  const runsToday = isNewDay(workflow.lastRunAt) ? 0 : (workflow.runsToday ?? 0);
  if ((workflow.maxRunsPerDay ?? 0) > 0 && runsToday >= workflow.maxRunsPerDay!) {
    throw new DomainError('CONFLICT', 'Daily run limit reached');
  }
  const now = Date.now();
  await ctx.db.patch(workflow._id, {
    status: 'pending', runsToday: runsToday + 1, lastRunAt: now,
    nodeStates: undefined, error: undefined, currentNodeId: undefined,
    startedAt: undefined, completedAt: undefined, updatedAt: now,
  });
  return await ctx.db.get(workflow._id);
}
