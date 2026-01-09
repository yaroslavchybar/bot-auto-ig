import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

function cleanString(val: unknown): string {
	return String(val ?? "").trim();
}

function clampLimit(val: unknown): number {
	const lim = Number.isFinite(Number(val)) ? Math.floor(Number(val)) : 200;
	return Math.max(1, Math.min(5000, lim));
}

function cleanMode(val: unknown): "auto" | "manual" {
	const s = cleanString(val).toLowerCase();
	return s === "manual" ? "manual" : "auto";
}

function cleanStatus(val: unknown): "idle" | "running" | "completed" | "failed" {
	const s = cleanString(val).toLowerCase();
	if (s === "running" || s === "completed" || s === "failed") return s;
	return "idle";
}

export const list = query({
	args: { kind: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const cleanedKind = cleanString(args.kind);
		const rows = cleanedKind
			? await ctx.db
					.query("scrapingTasks")
					.withIndex("by_kind", (q) => q.eq("kind", cleanedKind))
					.collect()
			: await ctx.db.query("scrapingTasks").collect();
		rows.sort((a, b) => b.createdAt - a.createdAt);
		return rows;
	},
});

export const getById = query({
	args: { id: v.id("scrapingTasks") },
	handler: async (ctx, args) => {
		return (await ctx.db.get(args.id)) ?? null;
	},
});

export const create = mutation({
	args: {
		name: v.string(),
		kind: v.optional(v.string()),
		mode: v.optional(v.string()),
		profileId: v.optional(v.string()),
		targetUsername: v.string(),
		limit: v.optional(v.number()),
		limitPerProfile: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const name = cleanString(args.name);
		if (!name) throw new Error("name is required");

		const targetUsername = cleanString(args.targetUsername);
		if (!targetUsername) throw new Error("targetUsername is required");

		const kind = cleanString(args.kind) || "followers";
		const mode = cleanMode(args.mode);
		const profileId = cleanString(args.profileId);

		if (mode === "manual" && !profileId) {
			throw new Error("profileId is required for manual mode");
		}

		const now = Date.now();
		const limitPerProfile = mode === "auto" && args.limitPerProfile !== undefined ? clampLimit(args.limitPerProfile) : undefined;
		const id = await ctx.db.insert("scrapingTasks", {
			name,
			kind,
			mode,
			profileId: mode === "manual" ? profileId : undefined,
			targetUsername,
			limit: clampLimit(args.limit),
			limitPerProfile,
			status: "idle",
			createdAt: now,
			updatedAt: now,
		});

		return await ctx.db.get(id);
	},
});

export const update = mutation({
	args: {
		id: v.id("scrapingTasks"),
		name: v.optional(v.string()),
		mode: v.optional(v.string()),
		profileId: v.optional(v.string()),
		targetUsername: v.optional(v.string()),
		limit: v.optional(v.number()),
		limitPerProfile: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db.get(args.id);
		if (!existing) throw new Error("Task not found");

		const nextMode = args.mode !== undefined ? cleanMode(args.mode) : (existing.mode as "auto" | "manual");
		const nextProfileId = args.profileId !== undefined ? cleanString(args.profileId) : (existing.profileId ?? "");
		if (nextMode === "manual" && !nextProfileId) {
			throw new Error("profileId is required for manual mode");
		}

		const patch: Record<string, unknown> = { updatedAt: Date.now() };
		if (args.name !== undefined) patch.name = cleanString(args.name) || existing.name;
		if (args.targetUsername !== undefined) {
			const cleaned = cleanString(args.targetUsername);
			if (!cleaned) throw new Error("targetUsername is required");
			patch.targetUsername = cleaned;
		}
		if (args.mode !== undefined) patch.mode = nextMode;
		if (args.profileId !== undefined) patch.profileId = nextMode === "manual" ? nextProfileId : undefined;
		if (args.limit !== undefined) patch.limit = clampLimit(args.limit);
		if (nextMode === "manual") patch.limitPerProfile = undefined;
		if (args.limitPerProfile !== undefined) patch.limitPerProfile = nextMode === "auto" ? clampLimit(args.limitPerProfile) : undefined;

		await ctx.db.patch(args.id, patch);
		return await ctx.db.get(args.id);
	},
});

export const remove = mutation({
	args: { id: v.id("scrapingTasks") },
	handler: async (ctx, args) => {
		await ctx.db.delete(args.id);
		return true;
	},
});

export const setStatus = mutation({
	args: {
		id: v.id("scrapingTasks"),
		status: v.string(),
		lastError: v.optional(v.string()),
		lastScraped: v.optional(v.number()),
		lastOutput: v.optional(v.any()),
		lastRunAt: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db.get(args.id);
		if (!existing) throw new Error("Task not found");

		const patch: Record<string, unknown> = {
			status: cleanStatus(args.status),
			updatedAt: Date.now(),
		};

		if (args.lastRunAt !== undefined) {
			patch.lastRunAt = Number.isFinite(Number(args.lastRunAt)) ? Number(args.lastRunAt) : Date.now();
		}
		if (args.lastError !== undefined) patch.lastError = cleanString(args.lastError) || undefined;
		if (args.lastScraped !== undefined) patch.lastScraped = Number.isFinite(Number(args.lastScraped)) ? Math.floor(Number(args.lastScraped)) : undefined;
		if (args.lastOutput !== undefined) patch.lastOutput = args.lastOutput;

		await ctx.db.patch(args.id, patch);
		return await ctx.db.get(args.id);
	},
});
