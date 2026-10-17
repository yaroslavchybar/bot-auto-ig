import { v } from 'convex/values';
import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { emptyWarmupActivity, warmupActivityPlan } from '../../server/shared/warmupPlan';

export const warmupActivityValidator = v.object({ likes: v.number(), profiles: v.number(), reels: v.number(), stories: v.number(), follows: v.optional(v.number()), saves: v.optional(v.number()), comments: v.optional(v.number()) });

export type WarmupPlan = {
	minMinutes: number;
	maxMinutes: number;
};

/** Default daily budget. */
export const DEFAULT_WARMUP_PLAN: WarmupPlan = {
	minMinutes: 10,
	maxMinutes: 20,
};

/** UTC date key (YYYY-MM-DD) for "today" counters. */
export function todayDate(now: number = Date.now()): string {
	return new Date(now).toISOString().slice(0, 10);
}

function planNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: fallback;
}

/** Read the editable warm-up plan from a warm-up node config. */
export function planFromConfig(config: Record<string, unknown>): WarmupPlan {
	// Match the minimum allowed by the node inputs.
	const minMinutes = Math.max(
		1,
		planNumber(config.warmup_min_minutes, DEFAULT_WARMUP_PLAN.minMinutes),
	);
	return {
		minMinutes,
		maxMinutes: Math.max(
			minMinutes,
			planNumber(config.warmup_max_minutes, DEFAULT_WARMUP_PLAN.maxMinutes),
		),
	};
}

/** Minutes assigned once per UTC day. */
export function randomMinutes(plan: WarmupPlan): number {
	return plan.minMinutes + Math.random() * Math.max(0, plan.maxMinutes - plan.minMinutes);
}

/** Draw today's budget once, before a browser is needed; do not reserve session time. */
export async function ensureDailyPlan(ctx: MutationCtx, profileId: Id<'profiles'>, plan: WarmupPlan, now: number) {
  const date = todayDate(now);
  const state = await ctx.db.query('warmupStates').withIndex('by_profile', q => q.eq('profileId', profileId)).unique();
  if (state?.date === date) return state;
  const day = state ? state.day + (state.runsToday > 0 || state.activeRun ? 1 : 0) : 1;
  const daily = {
    profileId, day, activityPlan: warmupActivityPlan(day), activityUsed: emptyWarmupActivity(), followAttempts: [],
    date, runsToday: 0, todayMinutes: day > 7 && Math.random() < 0.1 ? 0 : randomMinutes(plan), minutesUsedToday: 0,
    recentRunIds: [] as string[], updatedAt: now,
  };
  if (state) {
    await ctx.db.patch(state._id, { ...daily, activeRun: undefined });
    return (await ctx.db.get(state._id))!;
  }
  return (await ctx.db.get(await ctx.db.insert('warmupStates', daily)))!;
}
