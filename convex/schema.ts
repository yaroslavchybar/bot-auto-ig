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
		fingerprintOs: v.optional(v.string()),
		cookiesJson: v.optional(v.string()),
		listIds: v.optional(v.array(v.id("lists"))),
		lastOpenedAt: v.optional(v.number()),
		login: v.boolean(),
		dailyScrapingLimit: v.optional(v.number()),
		assignedAccountsLimit: v.optional(v.number()),
		dailyScrapingUsed: v.optional(v.number()),
	})
		.index("by_name", ["name"])
		.index("by_status", ["status"]),

	scrapeQuotaCommits: defineTable({
		key: v.string(),
		profileName: v.string(),
		amount: v.number(),
		createdAt: v.number(),
	}).index("by_key", ["key"]),

 	instagramAccounts: defineTable({
 		userName: v.string(),
 		fullName: v.optional(v.string()),
 		matchedName: v.optional(v.string()),
 		createdAt: v.number(),
 		assignedTo: v.optional(v.id("profiles")),
 		isVerified: v.optional(v.boolean()),
 		isPrivate: v.optional(v.boolean()),
  		sourceJobId: v.optional(v.id("scrapeJobs")),
		// Set only for scrape-inserted rows so listScraped can page the
		// index instead of scanning the whole table. Messaging rows omit it.
		scrapedAt: v.optional(v.number()),
		status: v.optional(v.union(
			v.literal("available"),
			v.literal("assigned"),
			v.literal("subscribed"),
			v.literal("unsubscribed"),
			v.literal("skipped"),
			v.literal("done"),
		)),
		message: v.boolean(),
		subscribedAt: v.optional(v.number()),
		lastMessagedAt: v.optional(v.number()),
	})
		.index("by_userName", ["userName"])
		.index("by_assignedTo", ["assignedTo"])
		.index("by_status", ["status"])
		.index("by_sourceJob", ["sourceJobId"])
		.index("by_scrapedAt", ["scrapedAt"])
		.index("by_assignedTo_status", ["assignedTo", "status"]),

 	scrapeJobs: defineTable({
 		name: v.string(),
 		targets: v.array(v.string()),
 		listIds: v.array(v.id("lists")),
		status: v.union(
			v.literal("idle"),
			v.literal("running"),
			v.literal("completed"),
			v.literal("failed"),
			v.literal("cancelled"),
		),
 		config: v.object({
 			maxToScrape: v.number(),
 			maxAttempts: v.number(),
 			retryBackoffSeconds: v.string(),
 			openDelaySeconds: v.number(),
			fields: v.object({
				fullName: v.boolean(),
				isVerified: v.boolean(),
				isPrivate: v.boolean(),
			}),
			skip: v.object({
				private: v.boolean(),
				verified: v.boolean(),
				noFullName: v.boolean(),
			}),
		}),
		stats: v.object({
			scraped: v.number(),
			deduped: v.number(),
			chunksCompleted: v.number(),
			targetsCompleted: v.number(),
		}),
		error: v.optional(v.string()),
		startedAt: v.optional(v.number()),
		completedAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_status", ["status"]),

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
