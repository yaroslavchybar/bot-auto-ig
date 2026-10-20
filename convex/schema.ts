import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { routineValidator } from './routinePolicy'
import { warmupActivityValidator } from './warmup/helpers'

const activityCounts = v.object({
  follows: v.number(),
  dms: v.number(),
  warmupMinutes: v.number(),
  scraperRequests: v.optional(v.number()),
})

export default defineSchema({
  analyticsDays: defineTable({ date: v.string(), counts: activityCounts }).index('by_date', [
    'date',
  ]),
  analyticsHistory: defineTable({ startedAt: v.number(), totals: activityCounts }),
  leadStats: defineTable({
    counts: v.object({
      total: v.number(),
      male: v.number(),
      assigned: v.number(),
    }),
    dataRevision: v.number(),
    backfillRevision: v.number(),
    backfillComplete: v.boolean(),
    backfillCursor: v.union(v.string(), v.null()),
    backfillJobId: v.optional(v.id('_scheduled_functions')),
  }),
  leadLists: defineTable({
    name: v.string(),
    createdAt: v.number(),
    scrapeLookbackDays: v.optional(v.number()),
    scrapeMonitor: v.optional(v.boolean()),
    scrapePostLimit: v.optional(v.number()),
  }),
  // Keep changing counts separate from list metadata subscriptions.
  leadListCounts: defineTable({
    listId: v.id('leadLists'),
    count: v.optional(v.number()),
    revision: v.optional(v.number()),
    sourceCount: v.optional(v.number()),
  }).index('by_list', ['listId']),
  leads: defineTable({
    igId: v.optional(v.string()),
    username: v.string(),
    fullName: v.optional(v.string()),
    isPrivate: v.optional(v.boolean()),
    classification: v.optional(
      v.union(v.literal('male'), v.literal('female'), v.literal('business')),
    ),
    screeningStatus: v.optional(
      v.union(v.literal('pending'), v.literal('ready'), v.literal('error')),
    ),
    englishTextCheckPassed: v.optional(v.boolean()),
    screenedAt: v.optional(v.number()),
    screeningToken: v.optional(v.string()),
    screeningProfileId: v.optional(v.id('profiles')),
    screeningAutomationId: v.optional(v.id('automations')),
    screeningListId: v.optional(v.id('leadLists')),
    screeningUntil: v.optional(v.number()),
    screeningFailures: v.optional(v.number()),
    screeningRefused: v.optional(v.boolean()),
    senderId: v.optional(v.id('profiles')),
    outreachListId: v.optional(v.id('leadLists')),
    outreachAutomationId: v.optional(v.id('automations')),
    createdAt: v.number(),
    dmSent: v.boolean(),
    followed: v.boolean(),
    followDate: v.optional(v.number()),
    followStartedAt: v.optional(v.number()),
    unfollowDays: v.optional(v.number()),
    unfollowAt: v.optional(v.number()),
    dmBlocked: v.optional(v.boolean()),
    dmEligible: v.optional(v.boolean()),
    followBackAt: v.optional(v.number()),
    postEngagement: v.optional(v.object({ kind: v.union(v.literal('like'), v.literal('comment')), at: v.number() })),
    lastDmCheckDate: v.optional(v.string()),
    dmStartedAt: v.optional(v.number()),
    dmStartedDate: v.optional(v.string()),
  })
    .index('by_username', ['username'])
    .index('by_ig_id', ['igId'])
    .index('by_classification', ['classification'])
    .index('by_dm_pending', ['senderId', 'dmEligible', 'dmStartedAt'])
    .index('by_screening', ['screeningStatus', 'screeningRefused'])
    .index('by_screening_profile', ['screeningProfileId'])
    .index('by_follow_due', ['senderId', 'followed', 'followDate'])
    .index('by_unfollow_due', ['senderId', 'followed', 'unfollowAt']),
  leadMemberships: defineTable({
    leadId: v.id('leads'),
    listId: v.id('leadLists'),
    available: v.boolean(),
    classification: v.optional(
      v.union(v.literal('male'), v.literal('female'), v.literal('business')),
    ),
    leadCreatedAt: v.number(),
  })
    .index('by_lead_list', ['leadId', 'listId'])
    .index('by_list_created', ['listId', 'leadCreatedAt'])
    .index('by_list_category', ['listId', 'available', 'classification', 'leadCreatedAt']),
  accountProgress: defineTable({
    profileId: v.id('profiles'),
    paused: v.boolean(),
    issue: v.optional(v.string()),
    activeDays: v.number(),
    outreachIncrease: v.optional(v.number()),
    outreachQuotaDate: v.optional(v.string()),
    lastFollowDate: v.optional(v.string()),
    sentToday: v.optional(v.number()),
    dmCountDate: v.optional(v.string()),
    followedToday: v.optional(v.number()),
    lastActivityDate: v.optional(v.string()),
    lastOutreachDate: v.optional(v.string()),
    lastNotificationsDate: v.optional(v.string()),
    lastNotificationsAt: v.optional(v.number()),
    lastLikerScanDate: v.optional(v.string()),
    outreachUsedToday: v.number(),
    outreachAllowanceToday: v.number(),
    lastLeadListId: v.optional(v.id('leadLists')),
    nextRunAt: v.number(),
    updatedAt: v.number(),
  }).index('by_profile', ['profileId']),
  ownPostLikerSnapshots: defineTable({
    profileId: v.id('profiles'),
    ownerIgId: v.string(),
    mediaId: v.string(),
    ids: v.array(v.string()),
    date: v.string(),
    updatedAt: v.number(),
  }).index('by_profile', ['profileId']).index('by_profile_media', ['profileId', 'mediaId']),
  models: defineTable({
    name: v.string(),
    baseFullName: v.optional(v.string()),
    fullNameVariations: v.optional(v.array(v.string())),
    usernames: v.optional(v.array(v.string())),
    contentKey: v.optional(v.string()),
    createdAt: v.number(),
  }),
  modelContentCleanup: defineTable({ contentKey: v.string() }).index('by_content', ['contentKey']),

  proxies: defineTable({
    name: v.string(),
    proxy: v.string(),
    proxyType: v.string(),
    purpose: v.optional(v.union(v.literal('work'), v.literal('login'))),
    // Max profiles allowed to use this proxy. Optional so rows written
    // before the limit existed still read; code treats missing as 3.
    maxProfiles: v.optional(v.number()),
    country: v.optional(v.string()),
    loginCooldownUntil: v.optional(v.number()),
    loginCooldownAccountId: v.optional(v.id('igAccounts')),
    loginClaim: v.optional(
      v.object({ accountId: v.id('igAccounts'), token: v.string(), expiresAt: v.number() }),
    ),
    createdAt: v.number(),
  })
    .index('by_name', ['name'])
    .index('by_proxy', ['proxy'])
    .index('by_purpose', ['purpose'])
    .index('by_created', ['createdAt']),

  igAccounts: defineTable({
    ciphertext: v.string(),
    usernameHash: v.string(),
    status: v.union(
      v.literal('available'),
      v.literal('assigned'),
      v.literal('connected'),
      v.literal('invalid'),
    ),
    profileId: v.optional(v.id('profiles')),
    error: v.optional(v.string()),
    retryAfter: v.optional(v.number()),
    browserLoggedInAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_created', ['createdAt'])
    .index('by_username_hash', ['usernameHash'])
    .index('by_status', ['status'])
    .index('by_status_browser_login', ['status', 'browserLoggedInAt', 'retryAfter'])
    .index('by_profile', ['profileId']),

  modelSetupStates: defineTable({
    profileId: v.id('profiles'),
    modelId: v.id('models'),
    startedAt: v.number(),
    targetUsername: v.optional(v.string()),
    fullName: v.optional(v.string()),
    usernameDone: v.optional(v.boolean()),
    fullNameDone: v.optional(v.boolean()),
    avatarDone: v.optional(v.boolean()),
    postSourceIds: v.array(v.string()),
    postTarget: v.optional(v.number()),
    postDates: v.array(v.string()),
    outreachReadyMarked: v.optional(v.boolean()),
    pending: v.optional(
      v.object({
        kind: v.union(
          v.literal('username'),
          v.literal('fullName'),
          v.literal('avatar'),
          v.literal('post'),
        ),
        sourceId: v.optional(v.string()),
        date: v.string(),
      }),
    ),
    error: v.optional(v.string()),
  })
    .index('by_profile', ['profileId'])
    .index('by_model', ['modelId']),
  modelSetupGroupNames: defineTable({
    modelId: v.id('models'),
    group: v.number(),
    name: v.string(),
  }).index('by_model_group', ['modelId', 'group']),

  profiles: defineTable({
    unreadChatCount: v.optional(v.number()),
    unreadChatsCheckedAt: v.optional(v.number()),
    paused: v.optional(v.boolean()),
    igAccountId: v.optional(v.id('igAccounts')),
    igLoggedIn: v.optional(v.boolean()),
    outreachReady: v.optional(v.boolean()),
    pendingRenameFrom: v.optional(v.string()),
    createdAt: v.number(),
    name: v.string(),
    proxy: v.optional(v.string()),
    proxyType: v.optional(v.string()),
    status: v.optional(v.string()),
    inUse: v.boolean(),
    fingerprintOs: v.optional(v.string()),
    fingerprintSeed: v.optional(v.number()),
    cookiesJson: v.optional(v.string()),
    instagramSessionId: v.optional(v.string()),
    scraperRateLimitCount: v.optional(v.number()),
    modelIds: v.optional(v.array(v.id('models'))),
    lastOpenedAt: v.optional(v.number()),
    scraperCooldownUntil: v.optional(v.number()),
  })
    .index('by_name', ['name'])
    .index('by_status', ['status'])
    .index('by_rename', ['pendingRenameFrom'])
    .index('by_created', ['createdAt']),
  // Worker subscriptions only depend on these small, independently changing projections.
  scraperProfiles: defineTable({
    paused: v.optional(v.boolean()),
    profileId: v.id('profiles'),
    name: v.string(),
    proxy: v.optional(v.string()),
    proxyType: v.optional(v.string()),
    inUse: v.boolean(),
    status: v.optional(v.string()),
    pendingRenameFrom: v.optional(v.string()),
    scraperReady: v.boolean(),
    scraperCooldownUntil: v.optional(v.number()),
  }).index('by_profile', ['profileId']),
  scraperRequestUsage: defineTable({
    profileId: v.id('profiles'),
    requests: v.array(v.object({ id: v.string(), reservedAt: v.number() })),
    sleepUntil: v.optional(v.number()),
  }).index('by_profile', ['profileId']),
  // Proxy tables read this small projection instead of profile cookies and runtime state.
  proxyProfileAssignments: defineTable({
    profileId: v.id('profiles'),
    name: v.string(),
    proxy: v.string(),
    proxyType: v.string(),
  })
    .index('by_profile', ['profileId'])
    .index('by_proxy', ['proxy', 'proxyType']),
  scrapeSources: defineTable({
    username: v.string(),
    listId: v.id('leadLists'),
    enabled: v.boolean(),
    deleting: v.optional(v.boolean()),
    running: v.boolean(),
    nextCheckAt: v.number(),
    lastPostsCheckAt: v.optional(v.number()),
    lastLikerCheckAt: v.optional(v.number()),
    averageLikes: v.optional(v.number()),
    postCount: v.number(),
    leadsAdded: v.number(),
    error: v.optional(v.string()),
    profileId: v.optional(v.id('profiles')),
    runId: v.optional(v.string()),
    leaseUntil: v.optional(v.number()),
    runKind: v.optional(v.union(v.literal('posts'), v.literal('likers'))),
    currentPostId: v.optional(v.id('scrapePosts')),
    createdAt: v.number(),
  })
    .index('by_profile', ['profileId', 'running'])
    .index('by_list_username', ['listId', 'username'])
    .index('by_due', ['enabled', 'running', 'nextCheckAt'])
    .index('by_lease', ['running', 'leaseUntil']),
  scrapePosts: defineTable({
    sourceId: v.id('scrapeSources'),
    mediaId: v.string(),
    code: v.string(),
    takenAt: v.number(),
    likeCount: v.optional(v.number()),
    scheduled: v.boolean(),
    monitoring: v.boolean(),
    nextCheckAt: v.number(),
    monitorStoppedAt: v.optional(v.number()),
    lastScrapedAt: v.optional(v.number()),
    firstScrapedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index('by_source_media', ['sourceId', 'mediaId'])
    .index('by_source_date', ['sourceId', 'takenAt'])
    .index('by_source_scheduled', ['sourceId', 'scheduled'])
    .index('by_due', ['scheduled', 'monitoring', 'nextCheckAt']),

  // One row per profile/list membership so runtime workers can query only
  // profiles assigned to their lists instead of scanning the whole table.
  profileModelAssignments: defineTable({
    profileId: v.id('profiles'),
    modelId: v.id('models'),
  })
    .index('by_profile', ['profileId'])
    .index('by_model', ['modelId']),

  // Per-profile daily budget, initialized on the first warm-up attempt each UTC day.
  warmupStates: defineTable({
    profileId: v.id('profiles'),
    // Warm-up day counter. Starts at 1, bumped once per day the profile runs warm-up.
    day: v.number(),
    // UTC date (YYYY-MM-DD) the counters below belong to.
    date: v.string(),
    // Next maintenance rest day, spaced 5–7 UTC calendar days apart.
    nextRestDate: v.optional(v.string()),
    // How many times warm-up ran for this profile today.
    runsToday: v.number(),
    // Minutes assigned for today's warm-up runs.
    todayMinutes: v.number(),
    // Elapsed session time, capped at the assigned daily budget.
    minutesUsedToday: v.optional(v.number()),
    activityPlan: v.optional(warmupActivityValidator),
    activityUsed: v.optional(warmupActivityValidator),
    followAttempts: v.optional(
      v.array(v.object({ username: v.string(), runId: v.string(), confirmed: v.boolean() })),
    ),
    followBlockedDate: v.optional(v.string()),
    // An interrupted worker keeps its reservation until the next UTC day.
    activeRun: v.optional(
      v.object({ id: v.string(), minutes: v.number(), restMinutes: v.number() }),
    ),
    nextRunAt: v.optional(v.number()),
    lastAutomationId: v.optional(v.string()),
    // Recent run ids for deduping retried record calls. Bounded so the
    // row cannot grow without limit; retries arrive within seconds.
    recentRunIds: v.optional(v.array(v.string())),
  })
    .index('by_profile', ['profileId'])
    .index('by_active_run', ['activeRun.id']),

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
    modelIds: v.optional(v.array(v.id('models'))),
    status: v.optional(
      v.union(
        v.literal('idle'),
        v.literal('pending'),
        v.literal('running'),
        v.literal('paused'),
        v.literal('completed'),
        v.literal('failed'),
        v.literal('cancelled'),
      ),
    ),
    currentNodeId: v.optional(v.string()), // currently executing node
    nodeStates: v.optional(v.any()), // map of nodeId -> execution state
    lastRunAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_status', ['status']),
})
