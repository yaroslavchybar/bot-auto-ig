import { DomainError } from '../errors';
import { routineValidator, validateRoutine } from '../routinePolicy';
import { assertAssignments } from '../routines';
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { mutation } from "../_generated/server";
import {
	statusValidator,
	normalizeListIds,
	getAutomationListIds,
	prepareAutomationRun,
	assertValidStatusTransition,
	type AutomationStatus,
} from "./helpers";

export const create = mutation({
	args: {
		name: v.string(),
		routine: v.optional(routineValidator),
		description: v.optional(v.string()),
		nodes: v.any(),
		edges: v.any(),
		listIds: v.optional(v.array(v.id("lists"))),
	},
	handler: async (ctx, args) => {
		const cleaned = String(args.name || "").trim();
		if (!cleaned) throw new DomainError('VALIDATION', "name is required");

		const now = Date.now();
		if (args.routine) validateRoutine(args.routine);
		const id = await ctx.db.insert("automations", {
			name: cleaned,
			routine: args.routine,
			description: args.description,
			nodes: args.nodes || [],
			edges: args.edges || [],
			listIds: normalizeListIds(args.listIds),
			// New automations start disabled; enabling is an explicit action.
			isActive: false,
			status: "idle",
			createdAt: now,
			updatedAt: now,
		});
		return await ctx.db.get(id);
	},
});

export const update = mutation({
	args: {
		id: v.id("automations"),
		name: v.optional(v.string()),
		routine: v.optional(routineValidator),
		description: v.optional(v.string()),
		nodes: v.optional(v.any()),
		edges: v.optional(v.any()),
		listIds: v.optional(v.array(v.id("lists"))),
		maxRetries: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const { id, ...updates } = args;
		const existing = await ctx.db.get(id);
		if (!existing) throw new DomainError('NOT_FOUND', "Automation not found");

		// Can only update idle/pending automations (not running)
		if (existing.status === "running" || (existing.routine && (existing.isActive || existing.status === 'pending'))) {
			throw new DomainError('CONFLICT', "Disable the automation and wait for the current session to stop before editing");
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
		if (updates.routine) {
          validateRoutine(updates.routine);
          await ctx.db.patch(id, { routine: updates.routine });
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

		const now = Date.now();
		const name = args.newName?.trim() || `${existing.name} (copy)`;

		const newId = await ctx.db.insert("automations", {
			name,
			description: existing.description,
			nodes: existing.nodes,
			edges: existing.edges,
			listIds: getAutomationListIds(existing),
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
            if (!automation.listIds?.length) {
              throw new DomainError('VALIDATION', 'Select at least one profile list');
            }
          }
        }
		await ctx.db.patch(args.id, {
			isActive: args.isActive,
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
	currentNodeId?: string;
	nodeStates?: any;
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
	args: { id: v.id("automations") },
	handler: startAutomation,
});

export const updateStatusInternal = internalMutation({
	args: {
		id: v.id("automations"),
		status: statusValidator,
		currentNodeId: v.optional(v.string()),
		nodeStates: v.optional(v.any()),
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
    // Drain bounded batches before startup continues. Updated rows leave these
    // index ranges, so the next call resumes without a cursor or a history scan.
    const batchSize = 100;
    const running = await ctx.db.query('automations').withIndex('by_status', q => q.eq('status', 'running')).take(batchSize);
    const pending = await ctx.db.query('automations').withIndex('by_status', q => q.eq('status', 'pending')).take(batchSize);
    const interrupted = [...running, ...pending];
    for (const automation of interrupted) {
      await ctx.db.patch(automation._id, { status: 'failed', error: 'Server restarted during execution', completedAt: Date.now(), updatedAt: Date.now() });
    }
    // Called only after orphan workers are stopped. Charge interrupted reserved time
    // conservatively, then release it so other sessions can continue today.
    const activeWarmups = await ctx.db.query('warmupStates').withIndex('by_active_run', q => q.gt('activeRun.id', undefined)).take(batchSize);
    for (const state of activeWarmups) {
      if (!state.activeRun) continue;
      await ctx.db.patch(state._id, {
        minutesUsedToday: Math.min(state.todayMinutes, (state.minutesUsedToday ?? 0) + state.activeRun.minutes),
        nextRunAt: Date.now() + state.activeRun.restMinutes * 60_000,
        activeRun: undefined,
      });
    }
    const reserved = await ctx.db.query('leads').withIndex('by_delivery', q => q.eq('delivery.state', 'reserved')).take(batchSize);
    const sending = await ctx.db.query('leads').withIndex('by_delivery', q => q.eq('delivery.state', 'sending')).take(batchSize);
    for (const lead of [...reserved, ...sending]) {
      await ctx.db.patch(lead._id, { status: 'uncertain', delivery: { ...lead.delivery!, state: 'uncertain' }, updatedAt: Date.now() });
      if (!lead.senderId) continue;
      const state = await ctx.db.query('accountProgress').withIndex('by_profile', q => q.eq('profileId', lead.senderId!)).unique();
      if (state) await ctx.db.patch(state._id, { issue: 'Interrupted delivery: review the recipient in Leads before resuming' });
    }
    const hasMore = [running, pending, activeWarmups, reserved, sending].some(rows => rows.length === batchSize);
    return { reconciled: interrupted.length, ...(hasMore ? { hasMore: true } : {}) };
  },
});
