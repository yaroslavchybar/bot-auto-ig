import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
	lists: defineTable({
		name: v.string(),
		createdAt: v.number(),
	}),

	profiles: defineTable({
		createdAt: v.number(),
		name: v.string(),
		proxy: v.optional(v.string()),
		proxyType: v.optional(v.string()),
		status: v.optional(v.string()),
		mode: v.optional(v.string()),
		sessionId: v.optional(v.string()),
		using: v.boolean(),
		testIp: v.boolean(),
		fingerprintSeed: v.optional(v.string()),
		fingerprintOs: v.optional(v.string()),
		cookiesJson: v.optional(v.string()),
		listIds: v.optional(v.array(v.id("lists"))),
		lastOpenedAt: v.optional(v.number()),
		login: v.boolean(),
		dailyScrapingLimit: v.optional(v.number()),
		dailyScrapingUsed: v.optional(v.number()),
		scrapeLeaseOwner: v.optional(v.string()),
		scrapeLeaseExpiresAt: v.optional(v.number()),
		scrapeHealth: v.optional(v.number()),
		lastScrapeFailureAt: v.optional(v.number()),
	})
		.index("by_name", ["name"])
		.index("by_status", ["status"]),

	instagramAccounts: defineTable({
		userName: v.string(),
		fullName: v.optional(v.string()),
		matchedName: v.optional(v.string()),
		createdAt: v.number(),
		assignedTo: v.optional(v.id("profiles")),
		status: v.optional(v.string()),
		message: v.boolean(),
		subscribedAt: v.optional(v.number()),
		lastMessagedAt: v.optional(v.number()),
	})
		.index("by_userName", ["userName"])
		.index("by_assignedTo", ["assignedTo"])
		.index("by_status", ["status"])
		.index("by_assignedTo_status", ["assignedTo", "status"]),

	messageTemplates: defineTable({
		kind: v.string(),
		texts: v.array(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_kind", ["kind"]),

	// ═══════════════════════════════════════════════════════════════════
	// WORKFLOW SYSTEM TABLES
	// ═══════════════════════════════════════════════════════════════════

	workflows: defineTable({
		// Definition fields
		name: v.string(),
		description: v.optional(v.string()),
		nodes: v.any(), // ReactFlow nodes array with positions and configs
		edges: v.any(), // ReactFlow edges array with connections

		// Scheduling fields
		isActive: v.optional(v.boolean()), // whether workflow is scheduled to run
		scheduleType: v.optional(v.union(
			v.literal("interval"),
			v.literal("daily"),
			v.literal("weekly"),
			v.literal("monthly"),
			v.literal("cron"),
			v.literal("instant")
		)),
		scheduleConfig: v.optional(v.object({
			// For interval: milliseconds between runs
			intervalMs: v.optional(v.number()),
			// For daily/weekly/monthly: time of day (UTC)
			hourUTC: v.optional(v.number()),
			minuteUTC: v.optional(v.number()),
			// For weekly: days of week (0-6, 0=Sunday)
			daysOfWeek: v.optional(v.array(v.number())),
			// For monthly: day of month (1-31)
			dayOfMonth: v.optional(v.number()),
			// For cron: raw cron expression
			cronspec: v.optional(v.string()),
		})),
		timezone: v.optional(v.string()), // e.g., "America/New_York"
		maxRunsPerDay: v.optional(v.number()),
		runsToday: v.optional(v.number()),
		lastRunAt: v.optional(v.number()),
		cronJobId: v.optional(v.string()), // ID from @convex-dev/crons

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
		scheduledAt: v.optional(v.number()), // when to run
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
		.index("by_status", ["status"])
		.index("by_scheduledAt", ["scheduledAt"]),

	workflowArtifacts: defineTable({
		name: v.string(),
		workflowId: v.id("workflows"),
		workflowName: v.string(),
		nodeId: v.string(),
		nodeLabel: v.optional(v.string()),
		kind: v.union(v.literal("followers"), v.literal("following")),
		targetUsername: v.optional(v.string()),
		targets: v.array(v.string()),
		status: v.optional(v.string()),
		imported: v.optional(v.boolean()),
		sourceProfileName: v.optional(v.string()),
		lastRunAt: v.optional(v.number()),
		storageId: v.optional(v.id("_storage")),
		manifestStorageId: v.optional(v.id("_storage")),
		exportStorageId: v.optional(v.id("_storage")),
		stats: v.optional(v.object({
			scraped: v.number(),
			deduped: v.number(),
			chunksCompleted: v.number(),
			targetsCompleted: v.number(),
		})),
		metadata: v.optional(v.any()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_workflowId", ["workflowId"])
		.index("by_workflowId_nodeId", ["workflowId", "nodeId"])
		.index("by_imported", ["imported"])
		.index("by_kind", ["kind"]),

	// ═══════════════════════════════════════════════════════════════════
	// KEYWORDS TABLE (for filtration name lists)
	// ═══════════════════════════════════════════════════════════════════

	keywords: defineTable({
		filename: v.string(), // e.g. "us_male_names.txt"
		content: v.string(), // newline-separated list of words
	}).index("by_filename", ["filename"]),
});
