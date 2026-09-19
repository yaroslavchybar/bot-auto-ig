import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
	DEFAULT_WARMUP_PLAN,
	planFromConfig,
	randomMinutes,
	todayDate,
	type WarmupPlan,
} from "./helpers";

async function getByProfileRow(ctx: any, profileId: any) {
	return await ctx.db
		.query("warmupStates")
		.withIndex("by_profile", (q: any) => q.eq("profileId", profileId))
		.unique();
}

/**
 * Record one warm-up run for a profile.
 *
 * Creates the state (day 1) on first run. If the stored date is not today
 * the daily cron was missed, so roll this row over first: bump the day when
 * it ran before, then reset the counters.
 */
export const recordRunInternal = internalMutation({
	args: {
		profileId: v.id("profiles"),
		automationId: v.string(),
		minutes: v.number(),
		// Stable id generated once per run by the worker. Retried record
		// calls carry the same id and must not increment the counter twice.
		runId: v.string(),
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		const today = todayDate(now);
		const existing = await getByProfileRow(ctx, args.profileId);
		if (!existing) {
			const id = await ctx.db.insert("warmupStates", {
				profileId: args.profileId,
				day: 1,
				date: today,
				runsToday: 1,
				todayMinutes: args.minutes,
				lastAutomationId: args.automationId,
				lastRunAt: now,
				recentRunIds: [args.runId],
				updatedAt: now,
			});
			return await ctx.db.get(id);
		}
		// Already recorded (including a retry arriving after later runs):
		// return without counting again.
		const recentRunIds: string[] = [
			...(existing.recentRunIds ?? []),
			// Rows written before recentRunIds existed carry lastRunId instead.
			...(typeof existing.lastRunId === "string" ? [existing.lastRunId] : []),
		];
		if (recentRunIds.includes(args.runId)) {
			return existing;
		}
		let day = existing.day;
		let runsToday = existing.runsToday;
		if (existing.date !== today) {
			if (runsToday > 0) day += 1;
			runsToday = 0;
		}
		await ctx.db.patch(existing._id, {
			day,
			date: today,
			runsToday: runsToday + 1,
			todayMinutes: args.minutes,
			lastAutomationId: args.automationId,
			lastRunAt: now,
			recentRunIds: [...recentRunIds, args.runId].slice(-20),
			updatedAt: now,
		});
		return await ctx.db.get(existing._id);
	},
});

/** Read the warm-up plan from one automation's warm-up node, if it has one. */
async function planForAutomation(ctx: any, automationId: string): Promise<WarmupPlan | null> {
	let automation = null;
	try {
		automation = await ctx.db.get(automationId as Id<"automations">);
	} catch {
		return null;
	}
	if (!automation || !Array.isArray(automation.nodes)) return null;
	const node = automation.nodes.find(
		(node: any) => node?.data?.activityId === "browse_feed",
	);
	if (!node) return null;
	return planFromConfig((node.data?.config ?? {}) as Record<string, unknown>);
}

/**
 * Daily rollover (run by cron shortly after UTC midnight).
 *
 * Processes states in bounded pages and schedules the next page, so the
 * tables can grow without blowing transaction limits. For each stale state:
 * bump the day when warm-up ran, reset today's counters, and assign today's
 * minutes from the plan of the automation that last ran warm-up there.
 */
export const rolloverDayInternal = internalMutation({
	args: {
		cursor: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const BATCH_SIZE = 100;
		const now = Date.now();
		const today = todayDate(now);
		const { page, isDone, continueCursor } = await ctx.db
			.query("warmupStates")
			.paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE });
		const plans = new Map<string, WarmupPlan>();
		for (const state of page) {
			if (!state.lastAutomationId || plans.has(state.lastAutomationId)) continue;
			const plan = await planForAutomation(ctx, state.lastAutomationId);
			if (plan) plans.set(state.lastAutomationId, plan);
		}
		let rolled = 0;
		for (const state of page) {
			if (state.date === today) continue;
			const plan = state.lastAutomationId
				? (plans.get(state.lastAutomationId) ?? DEFAULT_WARMUP_PLAN)
				: DEFAULT_WARMUP_PLAN;
			const day = state.runsToday > 0 ? state.day + 1 : state.day;
			await ctx.db.patch(state._id, {
				day,
				date: today,
				runsToday: 0,
				todayMinutes: randomMinutes(plan),
				updatedAt: now,
			});
			rolled += 1;
		}
		if (!isDone) {
			await ctx.scheduler.runAfter(0, internal.warmup.mutations.rolloverDayInternal, {
				cursor: continueCursor,
			});
		}
		return { rolled, done: isDone };
	},
});
