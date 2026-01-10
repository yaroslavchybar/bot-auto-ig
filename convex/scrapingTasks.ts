import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";

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

function cleanStatus(val: unknown): "idle" | "running" | "paused" | "completed" | "failed" {
	const s = cleanString(val).toLowerCase();
	if (s === "running" || s === "paused" || s === "completed" || s === "failed") return s;
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
		const id = await ctx.db.insert("scrapingTasks", {
			name,
			kind,
			mode,
			profileId: mode === "manual" ? profileId : undefined,
			targetUsername,
			limit: clampLimit(args.limit),
			imported: false,
			status: "idle",
			createdAt: now,
			updatedAt: now,
		});

		return await ctx.db.get(id);
	},
});

export const listUnimported = query({
	args: { kind: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const cleanedKind = cleanString(args.kind);
		const rows = cleanedKind
			? await ctx.db
					.query("scrapingTasks")
					.withIndex("by_kind", (q) => q.eq("kind", cleanedKind))
					.collect()
			: await ctx.db.query("scrapingTasks").collect();

		const filtered = rows.filter((t) => t.imported !== true && Boolean(t.storageId) && t.status === "completed");
		filtered.sort((a, b) => b.createdAt - a.createdAt);
		return filtered;
	},
});

export const setImported = mutation({
	args: { id: v.id("scrapingTasks"), imported: v.boolean() },
	handler: async (ctx, args) => {
		const existing = await ctx.db.get(args.id);
		if (!existing) throw new Error("Task not found");
		await ctx.db.patch(args.id, { imported: Boolean(args.imported), updatedAt: Date.now() });
		return await ctx.db.get(args.id);
	},
});

export const update = mutation({
	args: {
		id: v.id("scrapingTasks"),
		name: v.optional(v.string()),
		kind: v.optional(v.string()),
		mode: v.optional(v.string()),
		profileId: v.optional(v.string()),
		targetUsername: v.optional(v.string()),
		limit: v.optional(v.number()),
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
		if (args.kind !== undefined) patch.kind = cleanString(args.kind) || existing.kind;
		if (args.targetUsername !== undefined) {
			const cleaned = cleanString(args.targetUsername);
			if (!cleaned) throw new Error("targetUsername is required");
			patch.targetUsername = cleaned;
		}
		if (args.mode !== undefined) patch.mode = nextMode;
		if (args.profileId !== undefined) patch.profileId = nextMode === "manual" ? nextProfileId : undefined;
		if (args.limit !== undefined) patch.limit = clampLimit(args.limit);

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
		storageId: v.optional(v.id("_storage")),
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
		if (args.storageId !== undefined) patch.storageId = args.storageId;

		await ctx.db.patch(args.id, patch);
		return await ctx.db.get(args.id);
	},
});

export const storeScrapedData = action({
	args: {
		taskId: v.id("scrapingTasks"),
		users: v.any(),
		metadata: v.optional(v.any()),
	},
	handler: async (ctx, args) => {
		const { taskId, users, metadata } = args;

		// Try to delete old file if it exists (ignore errors)
		try {
			const existingTask = await ctx.runQuery(api.scrapingTasks.getById, { id: taskId });
			if (existingTask?.storageId) {
				await ctx.storage.delete(existingTask.storageId);
			}
		} catch {
			// Ignore errors when deleting old file
		}

		// Create JSON data with metadata
		const jsonData = {
			scrapedAt: Date.now(),
			taskId,
			count: Array.isArray(users) ? users.length : 0,
			metadata: metadata || {},
			users: users || [],
		};

		// Convert to JSON string and then to Blob
		const jsonString = JSON.stringify(jsonData, null, 2);
		const blob = new Blob([jsonString], { type: "application/json" });

		// Store the blob in Convex storage
		const storageId = await ctx.storage.store(blob);

		// Update the task with the storage ID
		await ctx.runMutation(internal.scrapingTasks.updateStorageId, {
			taskId,
			storageId,
		});

		return { storageId, count: jsonData.count };
	},
});

export const updateStorageId = internalMutation({
	args: {
		taskId: v.id("scrapingTasks"),
		storageId: v.id("_storage"),
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.taskId, {
			storageId: args.storageId,
			updatedAt: Date.now(),
		});
	},
});

export const getStorageUrl = query({
	args: { storageId: v.id("_storage") },
	handler: async (ctx, args) => {
		return await ctx.storage.getUrl(args.storageId);
	},
});
