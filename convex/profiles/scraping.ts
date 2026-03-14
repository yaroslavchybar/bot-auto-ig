import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import {
	claimBestScrapeLeaseRow,
	refreshScrapeLeaseRow,
	releaseScrapeLeaseRow,
	markScrapeSuccessRow,
	markScrapeFailureRow,
	sweepExpiredScrapeLeasesRow,
} from "./helpers";

export const claimBestScrapeLeaseInternal = internalMutation({
	args: {
		workerId: v.string(),
		leaseMs: v.number(),
		now: v.number(),
		minHealth: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		return await claimBestScrapeLeaseRow(ctx, args.workerId, args.leaseMs, args.now, args.minHealth ?? 25);
	},
});

export const refreshScrapeLeaseInternal = internalMutation({
	args: {
		profileId: v.id("profiles"),
		workerId: v.string(),
		leaseMs: v.number(),
		now: v.number(),
	},
	handler: async (ctx, args) => {
		return await refreshScrapeLeaseRow(ctx, args.profileId, args.workerId, args.leaseMs, args.now);
	},
});

export const releaseScrapeLeaseInternal = internalMutation({
	args: {
		profileId: v.id("profiles"),
		workerId: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		return await releaseScrapeLeaseRow(ctx, args.profileId, args.workerId);
	},
});

export const markScrapeSuccessInternal = internalMutation({
	args: {
		profileId: v.id("profiles"),
		workerId: v.string(),
		amount: v.number(),
		now: v.number(),
	},
	handler: async (ctx, args) => {
		return await markScrapeSuccessRow(ctx, args.profileId, args.amount, args.workerId, args.now);
	},
});

export const markScrapeFailureInternal = internalMutation({
	args: {
		profileId: v.id("profiles"),
		workerId: v.string(),
		now: v.number(),
	},
	handler: async (ctx, args) => {
		return await markScrapeFailureRow(ctx, args.profileId, args.workerId, args.now);
	},
});

export const sweepExpiredScrapeLeasesInternal = internalMutation({
	args: { now: v.number() },
	handler: async (ctx, args) => {
		return await sweepExpiredScrapeLeasesRow(ctx, args.now);
	},
});

export const resetDailyScrapingUsed = internalMutation({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query("profiles").collect();
		const toUpdate = rows.filter((r) => (r.dailyScrapingUsed || 0) !== 0);
		await Promise.all(toUpdate.map((p) => ctx.db.patch(p._id, { dailyScrapingUsed: 0 })));
		return true;
	},
});
