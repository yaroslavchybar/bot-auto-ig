export type WarmupPlan = {
	minMinutes: number;
	maxMinutes: number;
};

/** Fallback plan when no warm-up node config is available. */
export const DEFAULT_WARMUP_PLAN: WarmupPlan = {
	minMinutes: 30,
	maxMinutes: 60,
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
	// Floor at 1: a zero-minute plan would record minutes the API rejects,
	// and browsing for 0 minutes is meaningless. Matches the node input mins.
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

/** Minutes assigned for a run: random within the plan range. */
export function randomMinutes(plan: WarmupPlan): number {
	return plan.minMinutes + Math.random() * Math.max(0, plan.maxMinutes - plan.minMinutes);
}
