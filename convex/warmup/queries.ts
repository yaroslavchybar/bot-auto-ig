import { v } from "convex/values";
import { internalQuery, query } from "../_generated/server";

function toApi(row: any) {
	if (!row) return null;
	return {
		id: row._id,
		profileId: row.profileId,
		day: row.day,
		date: row.date,
		runsToday: row.runsToday,
		todayMinutes: row.todayMinutes,
		minutesUsedToday: row.minutesUsedToday ?? 0,
		lastAutomationId: row.lastAutomationId,
		lastRunAt: row.lastRunAt,
	};
}

async function getByProfileRow(ctx: any, profileId: any) {
	return await ctx.db
		.query("warmupStates")
		.withIndex("by_profile", (q: any) => q.eq("profileId", profileId))
		.unique();
}

export const getByProfileInternal = internalQuery({
	args: { profileId: v.id("profiles") },
	handler: async (ctx, args) => {
		return toApi(await getByProfileRow(ctx, args.profileId));
	},
});

export const listInternal = internalQuery({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query("warmupStates").collect();
		return rows.map(toApi);
	},
});

/** Warm-up state for one profile. Null until its first warm-up run. */
export const getByProfile = query({
	args: { profileId: v.id("profiles") },
	handler: async (ctx, args) => {
		return toApi(await getByProfileRow(ctx, args.profileId));
	},
});

/** All warm-up states, shown in the warm-up node settings. */
export const list = query({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query("warmupStates").collect();
		return rows.map(toApi);
	},
});
