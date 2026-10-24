import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { query } from "../_generated/server";
import type { QueryCtx } from '../_generated/server';
import { statusValidator, type AutomationStatus } from "./helpers";
import { requireServerBridgeAuth } from "../serverBridgeAuth";
import type { Doc, Id } from "../_generated/dataModel";
import { routineRetryState } from '../routineErrors';

function configRevision(routine: unknown, modelIds: unknown): string {
	const input = JSON.stringify({ routine: routine ?? null, modelIds: modelIds ?? [] });
	let hash = 2166136261;
	for (let index = 0; index < input.length; index++) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16);
}

async function listAutomations(ctx: QueryCtx, args: { status?: AutomationStatus }) {
	let rows;

	if (args.status) {
		rows = await ctx.db
			.query("automations")
			.withIndex("by_status", (q: any) => q.eq("status", args.status!))
			.collect();
	} else {
		rows = await ctx.db.query("automations").collect();
	}

	rows.sort((a: any, b: any) => b.updatedAt - a.updatedAt);
	return rows;
}

async function getAutomation(ctx: any, args: { id: string }) {
	const normalized = ctx.db.normalizeId("automations", args.id);
	if (!normalized) return null;
	return await ctx.db.get(normalized);
}

export const list = query({
	args: {
		status: v.optional(statusValidator),
	},
	handler: listAutomations,
});

export const listInternal = internalQuery({
	args: {
		status: v.optional(statusValidator),
	},
	handler: listAutomations,
});

export const get = query({
	args: { id: v.string() },
	handler: getAutomation,
});

export const getInternal = internalQuery({
	args: { id: v.string() },
	handler: getAutomation,
});

/** Small authenticated scheduler payload for routine automations. */
export const listRoutinesForScheduler = query({
	args: { bridgeToken: v.string() },
	handler: async (ctx, args) => {
		requireServerBridgeAuth(args.bridgeToken);
		return (await ctx.db.query("automations").collect())
			.filter((automation) => Boolean(automation.routine))
			.map((automation) => ({
				_id: automation._id,
				hasRoutine: true,
				modelIds: (automation.modelIds ?? []).map(String),
				isActive: automation.isActive,
				status: automation.status,
				configRevision: configRevision(automation.routine, automation.modelIds),
			}));
	},
});

/** Max profiles per worker snapshot page. One browser at a time, so bound reads. */
const MAX_RUNTIME_PROFILES = 200;
const MAX_RUNTIME_LISTS = 20;

function toRuntimeProfile(profile: Doc<'profiles'>) {
	return {
		id: profile._id,
		name: profile.name,
		status: profile.status,
		inUse: profile.inUse,
    paused: profile.paused,
		modelId: profile.modelId,
		lastOpenedAt: profile.lastOpenedAt,
		igLoggedIn: profile.igLoggedIn,
		outreachReady: profile.outreachReady,
		pendingRenameFrom: profile.pendingRenameFrom,
	};
}

/** Fetch profiles plus rest timers in small sequential batches to avoid I/O bursts. */
async function fetchRuntimeDetails(ctx: QueryCtx, profiles: Doc<'profiles'>[]) {
	// Subscribe to timing changes; client timers handle expiry without database polling.
	const warmups: any[] = [];
	const progresses: any[] = [];
    const accounts: any[] = [];
	for (let i = 0; i < profiles.length; i += 50) {
		const batch = profiles.slice(i, i + 50);
		const w = await Promise.all(
			batch.map((profile: any) =>
				ctx.db
					.query("warmupStates")
					.withIndex("by_profile", (q) => q.eq("profileId", profile._id))
					.unique(),
			),
		);
		const p = await Promise.all(
			batch.map((profile: any) =>
				ctx.db
					.query("accountProgress")
					.withIndex("by_profile", (q) => q.eq("profileId", profile._id))
					.unique(),
			),
		);
		accounts.push(...await Promise.all(batch.map((profile: any) => profile.igAccountId ? ctx.db.get(profile.igAccountId) : null)));
		warmups.push(...w);
		progresses.push(...p);
	}
	return {
		profiles: profiles.map((profile: any, index: number) => ({ ...toRuntimeProfile(profile),
          ...(profile.igAccountId ? { igAccountStatus: accounts[index]?.status ?? 'missing',
            browserLoggedInAt: accounts[index]?.browserLoggedInAt } : {}),
        })),
		warmups: profiles.map((profile: any, index: number) => ({
			profileId: profile._id,
			nextRunAt: warmups[index]?.nextRunAt ?? 0,
      ...(warmups[index] ? {
        date: warmups[index].date,
        todayMinutes: warmups[index].todayMinutes,
        minutesUsedToday: warmups[index].minutesUsedToday ?? 0,
        activeRun: Boolean(warmups[index].activeRun),
      } : {}),
		})),
		progress: profiles.map((profile: any, index: number) => {
      const state = routineRetryState(progresses[index]);
      return {
        profileId: profile._id,
        nextRunAt: state.nextRunAt,
        ...(state.issue ? { issue: state.issue } : {}),
      };
    }),
	};
}

/**
 * First-window snapshot for the reactive subscription. Reads only the head
 * page of each list (bounded), so it never scans full assignments. When
 * truncated the worker sweeps remaining windows through runtimeListPage.
 */
export const runtimeSnapshot = query({
	args: {
		bridgeToken: v.string(),
		id: v.id("automations"),
		modelIds: v.array(v.string()),
	},
	handler: async (ctx, args) => {
		requireServerBridgeAuth(args.bridgeToken);
		const automation = await ctx.db.get(args.id);
		if (!automation) return null;
		const assignedListIds = (automation.modelIds ?? []).map(String).slice(0, MAX_RUNTIME_LISTS);
		const seen = new Map<string, Doc<'profiles'>>();
		let truncated = false;
		for (const modelId of assignedListIds) {
			const head = await ctx.db
				.query("profiles")
				.withIndex("by_model", (q) => q.eq("modelId", modelId as unknown as Id<"models">))
				.paginate({ cursor: null, numItems: MAX_RUNTIME_PROFILES });
			for (const row of head.page) seen.set(String(row._id), row);
			if (!head.isDone) truncated = true;
			if (seen.size > MAX_RUNTIME_PROFILES) truncated = true;
		}
		const profiles = [...seen.values()].sort((a, b) => String(a._id).localeCompare(String(b._id))).slice(0, MAX_RUNTIME_PROFILES);
		if (seen.size > profiles.length) truncated = true;
		const details = await fetchRuntimeDetails(ctx, profiles);
		return {
			automation: {
				status: automation.status,
				isActive: automation.isActive,
				configRevision: configRevision(automation.routine, assignedListIds),
			},
			truncated,
			...details,
		};
	},
});

/**
 * Keyset page over a single list's assignment index. Each call performs one
 * bounded index read plus bounded profile/timing reads, so a full sweep
 * costs O(N) reads instead of rescanning every assignment per page.
 * Server-only (HTTP route already authed); the worker seeks with nextCursor.
 */
export const runtimeListPageInternal = internalQuery({
	args: {
		id: v.id("automations"),
		modelId: v.string(),
		cursor: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const automation = await ctx.db.get(args.id);
		if (!automation) return null;
		if (!automation.routine) return null;
		const assignedListIds = (automation.modelIds ?? [])
			.map(String)
			.slice(0, MAX_RUNTIME_LISTS);
		if (!assignedListIds.includes(String(args.modelId))) return null;
		const page = await ctx.db
			.query("profiles")
			.withIndex("by_model", (q) => q.eq("modelId", args.modelId as unknown as Id<"models">))
			.paginate({ cursor: args.cursor ?? null, numItems: MAX_RUNTIME_PROFILES });
		const details = await fetchRuntimeDetails(ctx, page.page);
		return {
			automation: {
				status: automation.status,
				isActive: automation.isActive,
				configRevision: configRevision(automation.routine, assignedListIds),
			},
			nextCursor: page.isDone ? null : page.continueCursor,
			isDone: page.isDone,
			...details,
		};
	},
});
