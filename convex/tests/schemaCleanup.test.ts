import { expect, test } from 'vite-plus/test'
import { convexTest } from 'convex-test'
import {
  defineSchema,
  defineTable,
  type GenericDataModel,
  type GenericMutationCtx,
} from 'convex/server'
import { v } from 'convex/values'
import { readFileSync } from 'node:fs'
import schema from '../schema'
import { internal } from '../_generated/api'
import { modules } from '../../tests/convex/helpers'
import {
  cleanupBatch,
  cleanupTables,
  compatibilitySchema,
  rescheduleExpiry,
} from '../../.github/scripts/schema-cleanup'

type MigrationCtx = GenericMutationCtx<GenericDataModel>
function permissiveTable(table: (typeof schema.tables)[keyof typeof schema.tables]) {
  let permissive = defineTable(v.any())
  for (const index of table[' indexes']())
    permissive = permissive.index(index.indexDescriptor, index.fields as [string, ...string[]])
  return permissive
}
const tables = Object.fromEntries(
  Object.entries(schema.tables).map(([name, table]) => [name, permissiveTable(table)]),
) as { [K in keyof typeof schema.tables]: ReturnType<typeof permissiveTable> }
const legacySchema = defineSchema({
  ...tables,
  lists: defineTable(v.any()),
  profileListAssignments: defineTable(v.any())
    .index('by_profile', ['profileId'])
    .index('by_list', ['listId']),
  messageTemplates: defineTable(v.any()),
  schemaCleanupModels: defineTable(v.any()).index('by_old', ['oldId']),
  schemaCleanupState: defineTable(v.any()),
})
const create = () => convexTest(legacySchema, modules)
async function migrate(t: ReturnType<typeof create>) {
  for (const table of cleanupTables) {
    let cursor: string | null = null
    for (let pages = 0; ; pages++) {
      if (pages > 100) throw new Error(`Migration did not finish: ${table}`)
      const page = await t.run((ctx) => cleanupBatch(ctx as MigrationCtx, { table, cursor }))
      if (page.done) break
      cursor = page.cursor
    }
  }
}

test('bridge schema accepts old rows while retaining indexed access', () => {
  const source = compatibilitySchema(readFileSync('convex/schema.ts', 'utf8'))
  expect(source).toContain('schemaCleanupModels')
  expect(source).toContain('profileListAssignments')
  expect(source).toContain('messageTemplates')
  for (const name of Object.keys(schema.tables))
    expect(source).toContain(`${name}: defineTable(v.any())`)
  expect(source).toContain(".index('by_username'")
})

test('migration preserves model identity, quota and uncertain actions and is repeatable', async () => {
  const t = create()
  const ids = await t.run(async (ctx) => {
    const model = await ctx.db.insert('lists', {
      name: 'Anna',
      fullName: 'Anna Smith',
      fullNames: ['Anna S.'],
      usernames: ['anna'],
      createdAt: 1,
    })
    const profile = await ctx.db.insert('profiles', {
      name: 'sender',
      using: true,
      renameFrom: 'old-name',
      sessionId: 'session-cookie',
      listIds: [model],
      cookiesJson: 'cookies',
      fingerprintSeed: 42,
      scraperCooldownUntil: 999,
      createdAt: 1,
      mode: 'proxy',
      scraperDailyLimit: null,
      scraperUsageCount: 4,
    })
    const assignment = await ctx.db.insert('profileListAssignments', {
      profileId: profile,
      listId: model,
    })
    const automation = await ctx.db.insert('automations', {
      name: 'routine',
      listIds: [model],
      nodes: [{ data: { listIds: [model] } }],
      edges: [],
      status: 'running',
      nodeStates: { saved: true },
      retryCount: 2,
      maxRetries: 3,
      createdAt: 1,
      updatedAt: 2,
    })
    const setup = await ctx.db.insert('modelSetupStates', {
      profileId: profile,
      modelId: model,
      startedAt: 1,
      nameDone: true,
      avatarSourceId: 'avatar',
      postSourceIds: ['post'],
      postDates: ['2026-10-17'],
      pending: { kind: 'name', date: '2026-10-17' },
    })
    const group = await ctx.db.insert('modelSetupGroupNames', {
      modelId: model,
      group: 0,
      name: 'Anna S.',
    })
    const cleanup = await ctx.db.insert('modelContentCleanup', { modelId: model })
    const progress = await ctx.db.insert('accountProgress', {
      profileId: profile,
      paused: false,
      activeDays: 19,
      used: 7,
      allowance: 10,
      followIncrease: 8,
      followQuotaDate: '2026-10-17',
      dmDate: '2026-10-17',
      sentToday: 3,
      followedToday: 2,
      nextRunAt: 456,
      updatedAt: 123,
      date: 'old',
      startedAt: 1,
      dmIncrease: 20,
    })
    const current = await ctx.db.insert('accountProgress', {
      profileId: profile,
      paused: false,
      activeDays: 2,
      used: 1,
      allowance: 2,
      followIncrease: 1,
      outreachIncrease: 9,
      followQuotaDate: 'old',
      outreachQuotaDate: '2026-10-17',
      outreachUsedToday: 4,
      outreachAllowanceToday: 5,
      nextRunAt: 77,
      updatedAt: 12,
    })
    const lead = await ctx.db.insert('leads', {
      username: 'lead',
      fullName: 'Lead Person',
      createdAt: 1,
      dmSent: false,
      followed: true,
      senderId: profile,
      followStartedAt: 11,
      followDate: 12,
      unfollowAt: 999,
      dmStartedAt: 33,
      dmStartedDate: '2026-10-17',
      enrichmentStatus: 'ready',
      followCheckPassed: true,
      enrichedAt: 10,
      enrichmentModel: 'retired',
      enrichmentConfidence: 0.9,
      classification: 'male',
    })
    const warmup = await ctx.db.insert('warmupStates', {
      profileId: profile,
      day: 8,
      date: '2026-10-17',
      runsToday: 1,
      todayMinutes: 20,
      minutesUsedToday: 10,
      activeRun: { id: 'reserved', minutes: 5, restMinutes: 60 },
      lastAutomationId: automation,
      recentRunIds: ['done'],
      updatedAt: 10,
      lastRunAt: 9,
      followBlockReason: 'blocked',
    })
    await ctx.db.insert('messageTemplates', { texts: ['retired'] })
    return {
      model,
      profile,
      assignment,
      automation,
      setup,
      group,
      cleanup,
      progress,
      current,
      lead,
      warmup,
    }
  })
  // Retry the copy before retiring old rows; the journal must reuse its generated IDs.
  await t.run((ctx) => cleanupBatch(ctx as MigrationCtx, { table: 'lists', cursor: null }))
  await t.run((ctx) => cleanupBatch(ctx as MigrationCtx, { table: 'lists', cursor: null }))
  await migrate(t)
  const snapshot = () =>
    t.run(async (ctx) => ({
      models: await ctx.db.query('models').collect(),
      oldModels: await ctx.db.query('lists').collect(),
      assignments: await ctx.db.query('profileModelAssignments').collect(),
      oldAssignments: await ctx.db.query('profileListAssignments').collect(),
      templates: await ctx.db.query('messageTemplates').collect(),
      profile: await ctx.db.get(ids.profile),
      automation: await ctx.db.get(ids.automation),
      setup: await ctx.db.get(ids.setup),
      group: await ctx.db.get(ids.group),
      cleanup: await ctx.db.get(ids.cleanup),
      progress: await ctx.db.get(ids.progress),
      current: await ctx.db.get(ids.current),
      lead: await ctx.db.get(ids.lead),
      warmup: await ctx.db.get(ids.warmup),
    }))
  const rows = await snapshot()
  expect(rows.models).toHaveLength(1)
  const model = rows.models[0]!
  expect(model._id).not.toBe(ids.model)
  expect(model).toMatchObject({
    contentKey: ids.model,
    baseFullName: 'Anna Smith',
    fullNameVariations: ['Anna S.'],
    usernames: ['anna'],
    createdAt: 1,
  })
  expect(model).not.toHaveProperty('fullName')
  expect(model).not.toHaveProperty('fullNames')
  expect(rows.oldModels).toEqual([])
  expect(rows.oldAssignments).toEqual([])
  expect(rows.templates).toEqual([])
  expect(rows.assignments).toMatchObject([{ profileId: ids.profile, modelId: model._id }])
  expect(rows.profile).toMatchObject({
    modelIds: [model._id],
    inUse: true,
    pendingRenameFrom: 'old-name',
    instagramSessionId: 'session-cookie',
    cookiesJson: 'cookies',
    fingerprintSeed: 42,
    scraperCooldownUntil: 999,
  })
  expect(rows.automation).toMatchObject({
    modelIds: [model._id],
    status: 'running',
    nodes: [{ data: { modelIds: [model._id] } }],
    nodeStates: { saved: true },
  })
  expect(rows.setup).toMatchObject({
    modelId: model._id,
    usernameDone: true,
    pending: { kind: 'username', date: '2026-10-17' },
    postSourceIds: ['post'],
  })
  expect(rows.group).toMatchObject({ modelId: model._id })
  expect(rows.cleanup).toMatchObject({ contentKey: ids.model })
  expect(rows.progress).toMatchObject({
    outreachUsedToday: 7,
    outreachAllowanceToday: 10,
    outreachIncrease: 8,
    outreachQuotaDate: '2026-10-17',
    dmCountDate: '2026-10-17',
    sentToday: 3,
    followedToday: 2,
    activeDays: 19,
    nextRunAt: 456,
    updatedAt: 123,
  })
  expect(rows.current).toMatchObject({
    outreachIncrease: 9,
    outreachQuotaDate: '2026-10-17',
    outreachUsedToday: 4,
    outreachAllowanceToday: 5,
  })
  expect(rows.lead).toMatchObject({
    fullName: 'Lead Person',
    screeningStatus: 'ready',
    englishTextCheckPassed: true,
    screenedAt: 10,
    followed: true,
    followStartedAt: 11,
    followDate: 12,
    unfollowAt: 999,
    dmStartedAt: 33,
    dmStartedDate: '2026-10-17',
  })
  expect(rows.warmup).toMatchObject({
    minutesUsedToday: 10,
    activeRun: { id: 'reserved', minutes: 5, restMinutes: 60 },
    recentRunIds: ['done'],
  })
  for (const [row, fields] of [
    [
      rows.profile,
      [
        'using',
        'renameFrom',
        'sessionId',
        'listIds',
        'mode',
        'scraperDailyLimit',
        'scraperUsageCount',
      ],
    ],
    [rows.automation, ['listIds', 'retryCount', 'maxRetries']],
    [
      rows.progress,
      [
        'used',
        'allowance',
        'followIncrease',
        'followQuotaDate',
        'dmDate',
        'date',
        'startedAt',
        'dmIncrease',
      ],
    ],
    [
      rows.lead,
      [
        'enrichmentStatus',
        'followCheckPassed',
        'enrichedAt',
        'enrichmentModel',
        'enrichmentConfidence',
      ],
    ],
    [rows.setup, ['nameDone', 'avatarSourceId']],
    [rows.warmup, ['updatedAt', 'lastRunAt', 'followBlockReason']],
  ] as const)
    for (const field of fields) expect(row).not.toHaveProperty(field)
  await migrate(t)
  expect(await snapshot()).toEqual(rows)
})

test('nested counters, request reservations and first scrape time migrate without losing live values', async () => {
  const t = create()
  const ids = await t.run(async (ctx) => {
    const profile = await ctx.db.insert('profiles', { name: 'scraper', using: false, createdAt: 1 })
    const source = await ctx.db.insert('scrapeSources', {
      username: 'source',
      listId: 'lead-list',
      enabled: true,
      running: false,
      nextCheckAt: 1,
      lastCheckAt: 11,
      discovered: 12,
      kind: 'posts',
      postsFromApify: true,
      postCount: 3,
      createdAt: 1,
    })
    const post = await ctx.db.insert('scrapePosts', {
      sourceId: source,
      mediaId: 'one',
      code: 'one',
      takenAt: 1,
      scheduled: true,
      monitoring: true,
      nextCheckAt: 50,
      lastScrapedAt: 1000,
      checks: [
        { at: 900, elapsedMs: 400, newIds: 1 },
        { at: 800, elapsedMs: 100, newIds: 2 },
      ],
      monitorEligible: true,
      observedLikeCount: 2,
    })
    const existingPost = await ctx.db.insert('scrapePosts', {
      sourceId: source,
      mediaId: 'two',
      firstScrapedAt: 300,
      lastScrapedAt: 1000,
      checks: [{ at: 900, elapsedMs: 400 }],
    })
    const usage = await ctx.db.insert('scraperRequestUsage', {
      profileId: profile,
      requests: [{ id: 'request', at: 123 }],
      sleepUntil: 999,
    })
    const counts = {
      follows: 4,
      dms: 3,
      warmupMinutes: 12.5,
      scraperRequests: 8,
      scraperUnits: 99,
      unlimitedScraperUnits: 10,
    }
    const day = await ctx.db.insert('analyticsDays', { date: '2026-10-17', counts })
    const history = await ctx.db.insert('analyticsHistory', { startedAt: 1, totals: counts })
    const jobId = await ctx.scheduler.runAfter(0, internal.leadStats.backfill, { cursor: null })
    const stats = await ctx.db.insert('leadStats', {
      counts: { total: 5, male: 2, assigned: 1, ready: 2, pending: 1, enriched: 4 },
      revision: 3,
      scanRevision: 2,
      complete: false,
      cursor: 'saved-cursor',
      jobId,
    })
    const list = await ctx.db.insert('leadLists', {
      name: 'leads',
      createdAt: 1,
      scrapeLookbackDays: 20,
      scrapePostLimit: 30,
      scrapeMonitor: true,
      scrapeMonitorDays: 7,
      scrapeIncludePrivate: false,
    })
    return { source, post, existingPost, usage, day, history, stats, list, jobId }
  })
  await migrate(t)
  await t.run(async (ctx) => {
    expect(await ctx.db.get(ids.source)).toMatchObject({
      lastPostsCheckAt: 11,
      leadsAdded: 12,
      runKind: 'posts',
      postCount: 3,
    })
    for (const key of ['postsFromApify', 'lastCheckAt', 'discovered', 'kind'])
      expect(await ctx.db.get(ids.source)).not.toHaveProperty(key)
    expect(await ctx.db.get(ids.post)).toMatchObject({
      firstScrapedAt: 500,
      lastScrapedAt: 1000,
      nextCheckAt: 50,
    })
    expect(await ctx.db.get(ids.existingPost)).toMatchObject({ firstScrapedAt: 300 })
    for (const key of ['checks', 'monitorEligible', 'observedLikeCount'])
      expect(await ctx.db.get(ids.post)).not.toHaveProperty(key)
    expect(await ctx.db.get(ids.usage)).toMatchObject({
      requests: [{ id: 'request', reservedAt: 123 }],
      sleepUntil: 999,
    })
    const counts = { follows: 4, dms: 3, warmupMinutes: 12.5, scraperRequests: 8 }
    expect((await ctx.db.get(ids.day))?.counts).toEqual(counts)
    expect((await ctx.db.get(ids.history))?.totals).toEqual(counts)
    expect(await ctx.db.get(ids.stats)).toMatchObject({
      counts: { total: 5, male: 2, assigned: 1 },
      dataRevision: 3,
      backfillRevision: 2,
      backfillComplete: false,
      backfillCursor: 'saved-cursor',
      backfillJobId: ids.jobId,
    })
    for (const key of ['revision', 'scanRevision', 'complete', 'cursor', 'jobId'])
      expect(await ctx.db.get(ids.stats)).not.toHaveProperty(key)
    expect(await ctx.db.get(ids.list)).toMatchObject({
      scrapeLookbackDays: 20,
      scrapePostLimit: 30,
      scrapeMonitor: true,
    })
    expect(await ctx.db.get(ids.list)).not.toHaveProperty('scrapeMonitorDays')
    expect(await ctx.db.get(ids.list)).not.toHaveProperty('scrapeIncludePrivate')
  })
})

test('bounded pages migrate every row and schedule canonical expiry jobs', async () => {
  const t = create()
  await t.run(async (ctx) => {
    for (let i = 0; i < 205; i++) await ctx.db.insert('messageTemplates', { text: String(i) })
    await ctx.db.insert('scrapePosts', {
      firstScrapedAt: Date.now(),
      scheduled: true,
      monitoring: true,
      nextCheckAt: Date.now() + 1000,
    })
  })
  let cursor: string | null = null
  let pages = 0
  for (;;) {
    const page = await t.run((ctx) =>
      cleanupBatch(ctx as MigrationCtx, { table: 'messageTemplates', cursor }),
    )
    pages++
    if (page.done) break
    cursor = page.cursor
  }
  expect(pages).toBe(3)
  expect(await t.run((ctx) => ctx.db.query('messageTemplates').collect())).toEqual([])
  await expect(
    t.run((ctx) => cleanupBatch(ctx as MigrationCtx, { table: 'unknown-table', cursor: null })),
  ).rejects.toThrow()
  await t.run((ctx) => cleanupBatch(ctx as MigrationCtx, { table: 'lists', cursor: null }))
  expect(await t.run((ctx) => ctx.db.query('schemaCleanupState').collect())).toMatchObject([
    { key: 'cleanup-v2' },
  ])
  const scheduled = await t.run((ctx) => rescheduleExpiry(ctx as MigrationCtx, { cursor: null }))
  expect(scheduled.done).toBe(true)
  expect(await t.run((ctx) => ctx.db.query('schemaCleanupState').collect())).toEqual([])
  const jobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())
  expect(
    jobs.some((job) => job.name.includes('scrapeSources') && job.name.includes('expirePost')),
  ).toBe(true)
})
