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
		automation: v.optional(v.boolean()),
		sessionId: v.optional(v.string()),
		using: v.boolean(),
		testIp: v.boolean(),
		fingerprintSeed: v.optional(v.string()),
		fingerprintOs: v.optional(v.string()),
		listId: v.optional(v.id("lists")),
		lastOpenedAt: v.optional(v.number()),
		login: v.boolean(),
		dailyScrapingLimit: v.optional(v.number()),
		dailyScrapingUsed: v.optional(v.number()),
	})
		.index("by_listId", ["listId"])
		.index("by_name", ["name"])
		.index("by_status", ["status"]),

	instagramAccounts: defineTable({
		userName: v.string(),
		createdAt: v.number(),
		assignedTo: v.optional(v.id("profiles")),
		status: v.optional(v.string()),
		linkSent: v.optional(v.string()),
		message: v.boolean(),
		subscribedAt: v.optional(v.number()),
		lastMessageSentAt: v.optional(v.number()),
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

	scrapingTasks: defineTable({
		name: v.string(),
		kind: v.string(),
		mode: v.string(),
		profileId: v.optional(v.string()),
		targetUsername: v.string(),
		limit: v.number(),
		imported: v.optional(v.boolean()),
		status: v.optional(v.string()),
		lastRunAt: v.optional(v.number()),
		lastScraped: v.optional(v.number()),
		lastError: v.optional(v.string()),
		lastOutput: v.optional(v.any()),
		storageId: v.optional(v.id("_storage")),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_createdAt", ["createdAt"])
		.index("by_status", ["status"])
		.index("by_kind", ["kind"]),

	// ═══════════════════════════════════════════════════════════════════
	// WORKFLOW SYSTEM TABLES
	// ═══════════════════════════════════════════════════════════════════

	workflows: defineTable({
		// Definition fields
		name: v.string(),
		description: v.optional(v.string()),
		nodes: v.any(), // ReactFlow nodes array with positions and configs
		edges: v.any(), // ReactFlow edges array with connections
		isTemplate: v.boolean(),
		category: v.optional(v.string()), // warmup, outreach, engagement, etc.

		// Scheduling fields
		isActive: v.optional(v.boolean()), // whether workflow is scheduled to run
		scheduleType: v.optional(v.union(
			v.literal("interval"),
			v.literal("daily"),
			v.literal("weekly"),
			v.literal("monthly"),
			v.literal("cron")
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

		// Execution fields (for non-template workflows)
		profileId: v.optional(v.id("profiles")), // assigned profile for execution
		status: v.optional(v.union(
			v.literal("idle"),
			v.literal("pending"),
			v.literal("running"),
			v.literal("paused"),
			v.literal("completed"),
			v.literal("failed"),
			v.literal("cancelled")
		)),
		priority: v.optional(v.number()), // higher runs first
		currentNodeId: v.optional(v.string()), // currently executing node
		nodeStates: v.optional(v.any()), // map of nodeId -> execution state
		progress: v.optional(v.number()), // 0-100 percentage
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
		.index("by_category", ["category"])
		.index("by_isTemplate", ["isTemplate"])
		.index("by_isActive", ["isActive"])
		.index("by_status", ["status"])
		.index("by_profileId", ["profileId"])
		.index("by_scheduledAt", ["scheduledAt"])
		.index("by_priority", ["priority"]),

	workflowLogs: defineTable({
		workflowId: v.id("workflows"),
		nodeId: v.optional(v.string()), // which node produced this log
		level: v.union(
			v.literal("info"),
			v.literal("warn"),
			v.literal("error"),
			v.literal("success"),
			v.literal("debug")
		),
		message: v.string(),
		metadata: v.optional(v.any()),
		timestamp: v.number(),
	})
		.index("by_workflowId", ["workflowId"])
		.index("by_timestamp", ["timestamp"])
		.index("by_workflowId_timestamp", ["workflowId", "timestamp"]),
});
