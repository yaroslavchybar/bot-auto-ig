import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
	lists: defineTable({
		name: v.string(),
		createdAt: v.number(),
	}),

	proxies: defineTable({
		name: v.string(),
		proxy: v.string(),
		proxyType: v.string(),
		// Max profiles allowed to use this proxy. Optional so rows written
		// before the limit existed still read; code treats missing as 3.
		maxProfiles: v.optional(v.number()),
		createdAt: v.number(),
	}).index("by_name", ["name"]),

	profiles: defineTable({
		createdAt: v.number(),
		name: v.string(),
		proxy: v.optional(v.string()),
		proxyType: v.optional(v.string()),
		status: v.optional(v.string()),
		mode: v.optional(v.string()),
		using: v.boolean(),
		fingerprintOs: v.optional(v.string()),
		cookiesJson: v.optional(v.string()),
		listIds: v.optional(v.array(v.id("lists"))),
		lastOpenedAt: v.optional(v.number()),
	})
		.index("by_name", ["name"])
		.index("by_status", ["status"]),

	messageTemplates: defineTable({
		kind: v.string(),
		texts: v.array(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_kind", ["kind"]),

	// ═══════════════════════════════════════════════════════════════════
	// AUTOMATION SYSTEM TABLES
	// ═══════════════════════════════════════════════════════════════════

	automations: defineTable({
		// Definition fields
		name: v.string(),
		description: v.optional(v.string()),
		nodes: v.any(), // ReactFlow nodes array with positions and configs
		edges: v.any(), // ReactFlow edges array with connections

		// Active toggle: disabled automations cannot be started
		isActive: v.optional(v.boolean()),

		// Execution fields
		listIds: v.optional(v.array(v.id("lists"))),
		status: v.optional(v.union(
			v.literal("idle"),
			v.literal("pending"),
			v.literal("running"),
			v.literal("paused"),
			v.literal("completed"),
			v.literal("failed"),
			v.literal("cancelled")
		)),
		currentNodeId: v.optional(v.string()), // currently executing node
		nodeStates: v.optional(v.any()), // map of nodeId -> execution state
		lastRunAt: v.optional(v.number()),
		startedAt: v.optional(v.number()),
		completedAt: v.optional(v.number()),
		error: v.optional(v.string()),
		retryCount: v.optional(v.number()),
		maxRetries: v.optional(v.number()),

		// Timestamps
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_name", ["name"])
		.index("by_isActive", ["isActive"])
		.index("by_status", ["status"]),
});
