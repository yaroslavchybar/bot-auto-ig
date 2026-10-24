import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

function toApi(row: Doc<'warmupStates'> | null) {
	if (!row) return null;
	return {
		id: row._id,
		profileId: row.profileId,
		day: row.day,
		date: row.date,
		runsToday: row.runsToday,
		todayMinutes: row.todayMinutes,
		minutesUsedToday: row.minutesUsedToday ?? 0,
		reservedMinutes: row.activeRun?.minutes ?? 0,
		nextRunAt: row.nextRunAt,
		lastAutomationId: row.lastAutomationId,
	};
}

async function getByProfileRow(ctx: QueryCtx, profileId: Id<'profiles'>) {
	return await ctx.db
		.query("warmupStates")
		.withIndex("by_profile", q => q.eq("profileId", profileId))
		.unique();
}

export const getByProfileInternal = internalQuery({
	args: { profileId: v.id("profiles") },
	handler: async (ctx, args) => {
		return toApi(await getByProfileRow(ctx, args.profileId));
	},
});
