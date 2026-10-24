import { DomainError } from '../errors';
import { recordActivity } from '../analyticsActivity';
import { routineValidator, validateRoutine, warmupPostRange, type RoutinePolicy } from '../routinePolicy';
import { updateWarmupPostTargets } from '../modelSetupPolicy';
import { assertAssignments } from '../routines';
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { mutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
	statusValidator,
	normalizeModelIds,
	prepareAutomationRun,
	assertValidStatusTransition,
	type AutomationStatus,
} from "./helpers";

async function assertModelAvailable(ctx: MutationCtx, modelIds: Id<'models'>[], exceptId?: Id<'automations'>) {
  if (modelIds.length !== 1) throw new DomainError('VALIDATION', 'Select exactly one model');
  const modelId = modelIds[0];
  if (!modelId || !await ctx.db.get(modelId)) throw new DomainError('VALIDATION', 'Model not found');
  const other = (await ctx.db.query('automations').collect()).find(row =>
    row._id !== exceptId && row.routine && row.modelIds?.includes(modelId));
  if (other) throw new DomainError('CONFLICT', 'This model already has an automation');
}

async function assertOutreachAssignment(ctx: MutationCtx, policy: RoutinePolicy, modelIds: Id<'models'>[]) {
  const route = policy.outreach;
  if (route) {
    if (!await ctx.db.get(route.leadListId)) throw new DomainError('VALIDATION', 'Scraped list not found');
    for (const profileId of route.profileIds) {
      const profile = await ctx.db.get(profileId);
      if (!profile || profile.status === 'deleting' || (!profile.modelId || !modelIds.includes(profile.modelId)))
        throw new DomainError('VALIDATION', 'Assigned profiles must belong to this automation’s model');
    }
  }
}

export const create = mutation({
	args: {
		name: v.string(),
		routine: routineValidator,
		description: v.optional(v.string()),
		modelIds: v.optional(v.array(v.id("models"))),
	},
	handler: async (ctx, args) => {
		const cleaned = String(args.name || "").trim();
		if (!cleaned) throw new DomainError('VALIDATION', "name is required");

		const now = Date.now();
		validateRoutine(args.routine);
		const modelIds = normalizeModelIds(args.modelIds);
		await assertModelAvailable(ctx, modelIds);
		await assertOutreachAssignment(ctx, args.routine, modelIds);
		const id = await ctx.db.insert("automations", {
			name: cleaned,
			routine: args.routine,
			description: args.description,
			modelIds,
			// New automations start disabled; enabling is an explicit action.
			isActive: false,
			status: "idle",
			createdAt: now,
			updatedAt: now,
		});
		if (modelIds[0]) await updateWarmupPostTargets(ctx, modelIds[0], args.routine);
		return await ctx.db.get(id);
	},
});

export const update = mutation({
	args: {
		id: v.id("automations"),
		name: v.optional(v.string()),
		routine: v.optional(routineValidator),
		description: v.optional(v.string()),
		modelIds: v.optional(v.array(v.id("models"))),
	},
	handler: async (ctx, args) => {
		const { id, ...updates } = args;
		const existing = await ctx.db.get(id);
		if (!existing) throw new DomainError('NOT_FOUND', "Automation not found");

		// Can only update idle/pending automations (not running)
		if (existing.status === "running" || (existing.routine && (existing.isActive || existing.status === 'pending'))) {
			throw new DomainError('CONFLICT', "Disable the automation and wait for the current session to stop before editing");
		}
		if (updates.routine || existing.routine) {
			validateRoutine(updates.routine ?? existing.routine!);
			await assertModelAvailable(ctx, normalizeModelIds(updates.modelIds ?? existing.modelIds), id);
			await assertOutreachAssignment(ctx, updates.routine ?? existing.routine!, normalizeModelIds(updates.modelIds ?? existing.modelIds));
		}

		const patch: Record<string, any> = { updatedAt: Date.now() };

		if (updates.name !== undefined) {
			const cleaned = String(updates.name || "").trim();
			if (!cleaned) throw new DomainError('VALIDATION', "name cannot be empty");
			patch.name = cleaned;
		}
		if (updates.description !== undefined) patch.description = updates.description;
		if (updates.modelIds !== undefined) patch.modelIds = normalizeModelIds(updates.modelIds);

		await ctx.db.patch(id, patch);
		if (updates.routine) {
          await ctx.db.patch(id, { routine: updates.routine });
        }
        const routine = updates.routine ?? existing.routine;
        if (routine) {
          const previousRange = warmupPostRange(existing.routine);
          const nextRange = warmupPostRange(routine);
          const modelId = normalizeModelIds(updates.modelIds ?? existing.modelIds)[0];
          if (previousRange[0] !== nextRange[0] || previousRange[1] !== nextRange[1] ||
              modelId !== existing.modelIds?.[0]) {
            if (modelId) await updateWarmupPostTargets(ctx, modelId, routine);
          }
        }
        await assertAssignments(ctx);
		return await ctx.db.get(id);
	},
});

export const remove = mutation({
	args: { id: v.id("automations") },
	handler: async (ctx, args) => {
		const automation = await ctx.db.get(args.id);
		if (!automation) throw new DomainError('NOT_FOUND', "Automation not found");

		// Can't delete running automations
		if (automation.status === "running" || (automation.routine && (automation.isActive || automation.status === 'pending'))) {
			throw new DomainError('CONFLICT', "Disable the automation and wait for the current session to stop before deleting");
		}

		await ctx.db.delete(args.id);
		return true;
	},
});

export const duplicate = mutation({
	args: {
		id: v.id("automations"),
		newName: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db.get(args.id);
		if (!existing) throw new DomainError('NOT_FOUND', "Automation not found");

		if (existing.routine) validateRoutine(existing.routine);
		const now = Date.now();
		const name = args.newName?.trim() || `${existing.name} (copy)`;

		const newId = await ctx.db.insert("automations", {
			name,
			description: existing.description,
			modelIds: [],
			isActive: false,
            routine: existing.routine,
			status: "idle",
			createdAt: now,
			updatedAt: now,
		});
		return await ctx.db.get(newId);
	},
});

// ═══════════════════════════════════════════════════════════════════
// ACTIVE TOGGLE
// ═══════════════════════════════════════════════════════════════════

export const setActive = mutation({
	args: {
		id: v.id("automations"),
		isActive: v.boolean(),
	},
	handler: async (ctx, args) => {
		const automation = await ctx.db.get(args.id);
		if (!automation) throw new DomainError('NOT_FOUND', "Automation not found");

        if (args.isActive) {
          await assertAssignments(ctx, { ...automation, isActive: true });
          if (automation.routine) {
            validateRoutine(automation.routine);
            await assertModelAvailable(ctx, normalizeModelIds(automation.modelIds), args.id);
          }
        }
		await ctx.db.patch(args.id, {
			isActive: args.isActive,
            // A sleeping routine has no worker left to acknowledge a stop.
            ...(automation.routine && !args.isActive && automation.status === 'pending'
              ? { status: 'cancelled' as const, completedAt: Date.now() } : {}),
			updatedAt: Date.now(),
		});
		return await ctx.db.get(args.id);
	},
});

// ═══════════════════════════════════════════════════════════════════
// EXECUTION MUTATIONS
// ═══════════════════════════════════════════════════════════════════

async function startAutomation(ctx: any, args: { id: any }) {
	const automation = await ctx.db.get(args.id);
	if (!automation) throw new DomainError('NOT_FOUND', "Automation not found");

	if (automation.status === "running") {
		throw new DomainError('CONFLICT', "Automation is already running");
	}

	// If already pending, just return
	if (automation.status === "pending") {
		return automation;
	}

	return await prepareAutomationRun(ctx, automation);
}

type UpdateStatusArgs = {
	id: any;
	status: AutomationStatus;
	error?: string;
};

async function updateAutomationStatus(ctx: any, args: UpdateStatusArgs) {
	const existing = await ctx.db.get(args.id);
	if (!existing) throw new DomainError('NOT_FOUND', "Automation not found");
	assertValidStatusTransition(existing.status as AutomationStatus | undefined, args.status as AutomationStatus);

	const patch: Record<string, any> = {
		status: args.status,
		updatedAt: Date.now(),
	};

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
	args: { id: v.id("automations") },
	handler: startAutomation,
});

export const updateStatusInternal = internalMutation({
	args: {
		id: v.id("automations"),
		status: statusValidator,
		error: v.optional(v.string()),
	},
	handler: updateAutomationStatus,
});

export const reset = mutation({
	args: { id: v.id("automations") },
	handler: async (ctx, args) => {
		const automation = await ctx.db.get(args.id);
		if (!automation) throw new DomainError('NOT_FOUND', "Automation not found");

		if (automation.status === "running") {
			throw new DomainError('CONFLICT', "Cannot reset running automation");
		}

		await ctx.db.patch(args.id, {
			status: "idle",
			error: undefined,
			startedAt: undefined,
			completedAt: undefined,
			updatedAt: Date.now(),
		});
		return await ctx.db.get(args.id);
	},
});

export const reconcileInterruptedInternal = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // Scan status rows in bounded pages, then select recovery candidates in memory.
    // Carry the cursor past unchanged waiting routines and genuine failures.
    const batchSize = 100;
    const now = Date.now();
    const restartError = 'Server restarted during execution';
    const batch = await ctx.db.query('automations')
      .withIndex('by_status', q => q.gte('status', 'failed').lte('status', 'running'))
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize, maximumRowsRead: batchSize });
    const interrupted = batch.page.filter(automation =>
      automation.status === 'running' ||
      (automation.status === 'pending' && automation.isActive !== true) ||
      (automation.status === 'failed' && automation.routine && automation.error === restartError));
    for (const automation of interrupted) {
      // Account progress persists. The scheduler decides when
      // the next session is allowed after budgets and cooldowns are restored.
      await ctx.db.patch(automation._id, {
        status: automation.isActive === true ? 'pending' : 'cancelled',
        error: undefined,
        startedAt: undefined,
        completedAt: automation.isActive === true ? undefined : now,
        updatedAt: now,
      });
    }
    // Called only after orphan workers are stopped. Charge interrupted reserved time
    // conservatively, then release it so other sessions can continue today.
    const activeWarmups = await ctx.db.query('warmupStates').withIndex('by_active_run', q => q.gt('activeRun.id', undefined)).take(batchSize);
    for (const state of activeWarmups) {
      if (!state.activeRun) continue;
      const usedMinutes = Math.min(state.todayMinutes, (state.minutesUsedToday ?? 0) + state.activeRun.minutes);
      await recordActivity(ctx, state.date, { warmupMinutes: usedMinutes - (state.minutesUsedToday ?? 0) });
      await ctx.db.patch(state._id, {
        minutesUsedToday: usedMinutes,
        // Interrupted input is uncertain; do not repeat today's engagement after recovery.
        ...(state.activityPlan ? { activityUsed: { ...state.activityPlan,
          reels: state.activityUsed?.reels ?? 0, stories: state.activityUsed?.stories ?? 0 } } : {}),
        nextRunAt: Math.ceil(Math.max(state.nextRunAt ?? 0, now + state.activeRun.restMinutes * 60_000)),
        activeRun: undefined,
      });
    }
    const hasMore = !batch.isDone || activeWarmups.length === batchSize;
    return { reconciled: interrupted.length, ...(hasMore ? { hasMore: true, cursor: batch.continueCursor } : {}) };
  },
});
