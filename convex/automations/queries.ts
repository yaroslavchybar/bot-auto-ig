import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { query } from "../_generated/server";
import type { QueryCtx } from '../_generated/server';
import { statusValidator, type AutomationStatus } from "./helpers";
import { requireServerBridgeAuth } from "../serverBridgeAuth";
import type { Id } from "../_generated/dataModel";

function configRevision(routine: unknown, listIds: unknown): string {
	const input = JSON.stringify({ routine: routine ?? null, listIds: listIds ?? [] });
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
				isActive: automation.isActive,
				status: automation.status,
				configRevision: configRevision(automation.routine, automation.listIds),
			}));
	},
});

/** Max profiles per worker snapshot page. One browser at a time, so bound reads. */
const MAX_RUNTIME_PROFILES = 200;
const MAX_RUNTIME_LISTS = 20;

function resolveAssignedListIds(automation: any, listIds: string[]): string[] {
	return (automation.routine
		? (automation.listIds ?? []).map(String)
		: listIds
	).slice(0, MAX_RUNTIME_LISTS);
}

function toRuntimeProfile(profile: any) {
	return {
		id: profile._id,
		name: profile.name,
		status: profile.status,
		using: profile.using,
		listIds: profile.listIds,
		lastOpenedAt: profile.lastOpenedAt,
		igLoggedIn: profile.igLoggedIn,
		outreachReady: profile.outreachReady,
		renameFrom: profile.renameFrom,
	};
}

/** Fetch profiles plus rest timers in small sequential batches to avoid I/O bursts. */
async function fetchRuntimeDetails(ctx: QueryCtx, profileIds: string[]) {
	const profiles: any[] = [];
	for (let i = 0; i < profileIds.length; i += 50) {
		const batch = await Promise.all(profileIds.slice(i, i + 50).map((id) => ctx.db.get(id as any)));
		for (const row of batch) if (row) profiles.push(row);
	}
	// Subscribe to timing changes; client timers handle expiry without database polling.
	const warmups: any[] = [];
	const progresses: any[] = [];
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
		warmups.push(...w);
		progresses.push(...p);
	}
	return {
		profiles: profiles.map(toRuntimeProfile),
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
		progress: profiles.map((profile: any, index: number) => ({
			profileId: profile._id,
			nextRunAt: progresses[index]?.nextRunAt ?? 0,
      ...(progresses[index]?.paused ? { paused: true } : {}),
      ...(progresses[index]?.issue ? { issue: progresses[index].issue } : {}),
		})),
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
		listIds: v.array(v.string()),
	},
	handler: async (ctx, args) => {
		requireServerBridgeAuth(args.bridgeToken);
		const automation = await ctx.db.get(args.id);
		if (!automation) return null;
		const assignedListIds = resolveAssignedListIds(automation, args.listIds);
		const seen = new Set<string>();
		let truncated = false;
		for (const listId of assignedListIds) {
			const head = await ctx.db
				.query("profileListAssignments")
				.withIndex("by_list", (q) => q.eq("listId", listId as unknown as Id<"lists">))
				.paginate({ cursor: null, numItems: MAX_RUNTIME_PROFILES });
			for (const row of head.page) seen.add(String(row.profileId));
			if (!head.isDone) truncated = true;
			if (seen.size > MAX_RUNTIME_PROFILES) truncated = true;
		}
		const profileIds = [...seen].sort().slice(0, MAX_RUNTIME_PROFILES);
		if (seen.size > profileIds.length) truncated = true;
		const details = await fetchRuntimeDetails(ctx, profileIds);
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
		listId: v.string(),
		cursor: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const automation = await ctx.db.get(args.id);
		if (!automation) return null;
		if (!automation.routine) return null;
		const assignedListIds = (automation.listIds ?? [])
			.map(String)
			.slice(0, MAX_RUNTIME_LISTS);
		if (!assignedListIds.includes(String(args.listId))) return null;
		const page = await ctx.db
			.query("profileListAssignments")
			.withIndex("by_list", (q) => q.eq("listId", args.listId as unknown as Id<"lists">))
			.paginate({ cursor: args.cursor ?? null, numItems: MAX_RUNTIME_PROFILES });
		const profileIds = [...new Set(page.page.map((row) => String(row.profileId)))];
		const details = await fetchRuntimeDetails(ctx, profileIds);
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
