import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { routineValidator } from './routinePolicy';

export default defineSchema({
  leadLists: defineTable({ name: v.string(), createdAt: v.number() }),
  leads: defineTable({
    igId: v.optional(v.string()), username: v.string(),
    fullName: v.optional(v.string()),
    profilePicUrl: v.optional(v.string()), profilePicDescription: v.optional(v.string()),
    pictureBatchId: v.optional(v.string()),
    classification: v.optional(v.union(v.literal('male'), v.literal('female'), v.literal('business'))),
    enrichmentStatus: v.optional(v.union(v.literal('pending'), v.literal('describing'), v.literal('ready'), v.literal('error'))),
    senderId: v.optional(v.id('profiles')), createdAt: v.number(),
    dmSent: v.boolean(), followed: v.boolean(), followDate: v.optional(v.number()),
  }).index('by_username', ['username'])
    .index('by_ig_id', ['igId'])
    .index('by_classification', ['classification'])
    .index('by_enrichment', ['enrichmentStatus'])
    .index('by_follow_due', ['senderId', 'followed', 'followDate']),
  leadMemberships: defineTable({
    leadId: v.id('leads'), listId: v.id('leadLists'), available: v.boolean(), leadCreatedAt: v.number(),
  }).index('by_lead_list', ['leadId', 'listId'])
    .index('by_list_created', ['listId', 'leadCreatedAt'])
    .index('by_list_available', ['listId', 'available', 'leadCreatedAt']),
  accountProgress: defineTable({
    profileId: v.id('profiles'),
    paused: v.boolean(), issue: v.optional(v.string()), activeDays: v.number(), outreachDays: v.number(),
    lastActivityDate: v.optional(v.string()), lastOutreachDate: v.optional(v.string()),
    date: v.string(), used: v.number(), allowance: v.number(), nextRunAt: v.number(),
    startedAt: v.number(), updatedAt: v.number(),
  }).index('by_profile', ['profileId']),
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
        igLoggedIn: v.optional(v.boolean()),
        outreachReady: v.optional(v.boolean()),
		renameFrom: v.optional(v.string()),
		createdAt: v.number(),
		name: v.string(),
		proxy: v.optional(v.string()),
		proxyType: v.optional(v.string()),
		status: v.optional(v.string()),
		mode: v.optional(v.string()),
		using: v.boolean(),
		fingerprintOs: v.optional(v.string()),
		cookiesJson: v.optional(v.string()),
		sessionId: v.optional(v.string()),
		scraperDailyLimit: v.optional(v.number()),
		scraperUsageDate: v.optional(v.string()),
		scraperUsageCount: v.optional(v.number()),
		scraperRateLimitCount: v.optional(v.number()),
		listIds: v.optional(v.array(v.id("lists"))),
		lastOpenedAt: v.optional(v.number()),
		scraperCooldownUntil: v.optional(v.number()),
	})
		.index("by_name", ["name"])
		.index("by_status", ["status"]),

  scrapeJobs: defineTable({
    username: v.string(), listId: v.id('leadLists'), sinceDate: v.number(),
    postLimit: v.number(),
    activeKey: v.optional(v.string()),
    status: v.union(v.literal('queued'), v.literal('running'), v.literal('completed'), v.literal('failed'), v.literal('paused')),
    profileId: v.optional(v.id('profiles')),
    runId: v.optional(v.string()), leaseUntil: v.optional(v.number()),
    postIndex: v.optional(v.number()),
    posts: v.optional(v.array(v.object({ id: v.string(), code: v.string() }))),
    discovered: v.number(),
    error: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number(),
  }).index('by_status_lease', ['status', 'leaseUntil']).index('by_active_key', ['activeKey']),

	// One row per profile/list membership so runtime workers can query only
	// profiles assigned to their lists instead of scanning the whole table.
	profileListAssignments: defineTable({
		profileId: v.id("profiles"),
		listId: v.id("lists"),
	})
		.index("by_profile", ["profileId"])
		.index("by_list", ["listId"])
		.index("by_profile_list", ["profileId", "listId"]),


	messageTemplates: defineTable({
		kind: v.string(),
		texts: v.array(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_kind", ["kind"]),

	// Per-profile daily budget, initialized on the first warm-up attempt each UTC day.
	warmupStates: defineTable({
		profileId: v.id("profiles"),
		// Warm-up day counter. Starts at 1, bumped once per day the profile runs warm-up.
		day: v.number(),
		// UTC date (YYYY-MM-DD) the counters below belong to.
		date: v.string(),
		// How many times warm-up ran for this profile today.
		runsToday: v.number(),
		// Minutes assigned for today's warm-up runs.
		todayMinutes: v.number(),
		// Elapsed session time, capped at the assigned daily budget.
		minutesUsedToday: v.optional(v.number()),
		// An interrupted worker keeps its reservation until the next UTC day.
		activeRun: v.optional(v.object({ id: v.string(), minutes: v.number(), restMinutes: v.number() })),
		nextRunAt: v.optional(v.number()),
		lastAutomationId: v.optional(v.string()),
		lastRunAt: v.optional(v.number()),
		// Recent run ids for deduping retried record calls. Bounded so the
		// row cannot grow without limit; retries arrive within seconds.
		recentRunIds: v.optional(v.array(v.string())),
		updatedAt: v.number(),
	}).index("by_profile", ["profileId"]).index('by_active_run', ['activeRun.id']),

	// ═══════════════════════════════════════════════════════════════════
	// AUTOMATION SYSTEM TABLES
	// ═══════════════════════════════════════════════════════════════════

	automations: defineTable({
    routine: v.optional(routineValidator),
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
