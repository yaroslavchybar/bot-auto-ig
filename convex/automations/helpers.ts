import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { DomainError } from '../errors';
import { v } from "convex/values";

export type AutomationStatus = "idle" | "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";

export function assertValidStatusTransition(currentStatus: AutomationStatus | undefined, nextStatus: AutomationStatus) {
	const current = currentStatus ?? "idle";
	const allowedTransitions: Record<AutomationStatus, AutomationStatus[]> = {
		idle: ["idle", "pending"],
		pending: ["pending", "running", "completed", "failed", "cancelled"],
		running: ["running", "pending", "paused", "completed", "failed", "cancelled"],
		paused: ["paused", "running", "failed", "cancelled"],
		completed: ["completed"],
		failed: ["failed"],
		cancelled: ["cancelled"],
	};

	if (!allowedTransitions[current].includes(nextStatus)) {
		throw new DomainError('CONFLICT', `Illegal automation status transition from ${current} to ${nextStatus}; use reset or retry`);
	}
}

export function normalizeModelIds(modelIds: Id<'models'>[] | undefined): Id<'models'>[] {
	return [...new Set(modelIds ?? [])];
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

/** Marks the automation pending and clears previous run state. */
export async function prepareAutomationRun(ctx: MutationCtx, automation: Doc<'automations'>) {
  if (automation.status === 'running' || automation.status === 'pending') {
    throw new DomainError('CONFLICT', 'Automation is already running or pending');
  }
  if (automation.isActive === false) {
    throw new DomainError('CONFLICT', 'Automation is disabled');
  }
  const now = Date.now();
  await ctx.db.patch(automation._id, {
    status: 'pending', lastRunAt: now,
    error: undefined,
    startedAt: undefined, completedAt: undefined, updatedAt: now,
  });
  return await ctx.db.get(automation._id);
}
