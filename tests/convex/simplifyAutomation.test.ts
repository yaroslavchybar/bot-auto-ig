import { expect, test } from 'vite-plus/test'
import { api, internal } from '../../convex/_generated/api'
import { defaultRoutine } from '../../convex/routinePolicy'
import { recordActivity } from '../../convex/analyticsActivity'
import { createConvexTest } from './helpers'

async function legacyFixture() {
  const t = createConvexTest()
  const ids = await t.run(async (ctx) => {
    const modelId = await ctx.db.insert('models', { name: 'Model', createdAt: 1 })
    const profileId = await ctx.db.insert('profiles', {
      name: 'Profile',
      inUse: false,
      createdAt: 1,
      modelIds: [modelId],
      fingerprintSeed: 123456,
      cookiesJson: 'saved cookies',
      igLoggedIn: true,
    })
    await ctx.db.insert('profileModelAssignments', { profileId, modelId })
    const progressId = await ctx.db.insert('accountProgress', {
      profileId,
      paused: true,
      activeDays: 12,
      outreachUsedToday: 4,
      outreachAllowanceToday: 7,
      outreachQuotaDate: '2026-10-23',
      followedToday: 3,
      dmCountDate: '2026-10-22',
      sentToday: 2,
      nextRunAt: 123,
      updatedAt: 1,
    })
    const leadListId = await ctx.db.insert('leadLists', { name: 'Leads', createdAt: 1 })
    await ctx.db.patch(progressId, { lastLeadListId: leadListId })
    const automationId = await ctx.db.insert('automations', {
      name: 'Routine',
      createdAt: 1,
      updatedAt: 1,
      isActive: false,
      modelIds: [modelId],
      nodes: [],
      edges: [],
      currentNodeId: 'old',
      nodeStates: { saved: true },
      routine: {
        ...defaultRoutine,
        outreachEnabled: true,
        message: 'legacy fallback',
        leadListId,
        outreachStartDay: 1,
        dailyIncrease: 35,
        outreachRoutes: [{ leadListId, profileIds: [profileId], message: 'Hello [name]' }],
      },
    })
    await ctx.db.insert('warmupStates', {
      profileId,
      date: '2026-10-23',
      day: 12,
      runsToday: 1,
      todayMinutes: 20,
      minutesUsedToday: 5,
      followAttempts: [{ username: 'lead', runId: 'run', confirmed: true }],
    })
    await ctx.db.insert('analyticsDays', {
      date: '2026-10-23',
      counts: {
        follows: 0,
        dms: 0,
        warmupMinutes: 0,
        scraperRequests: 6,
      },
    })
    return { modelId, profileId, progressId, automationId, leadListId }
  })
  return { t, ...ids }
}

test('migration preserves identity, pause, audience, message, budgets and surviving analytics exactly once', async () => {
  const s = await legacyFixture()
  await s.t.mutation(internal.migrations.simplifyAutomation.run, {})
  const first = await s.t.run(async (ctx) => ({
    profile: await ctx.db.get(s.profileId),
    progress: await ctx.db.get(s.progressId),
    automation: await ctx.db.get(s.automationId),
    memberships: await ctx.db.query('profileModelAssignments').collect(),
    history: await ctx.db.query('analyticsHistory').unique(),
    days: await ctx.db.query('analyticsDays').collect(),
    worker: await ctx.db.query('scraperProfiles').unique(),
  }))
  expect(first.profile).toMatchObject({
    modelId: s.modelId,
    paused: true,
    fingerprintSeed: 123456,
    cookiesJson: 'saved cookies',
    igLoggedIn: true,
  })
  expect(first.profile).not.toHaveProperty('modelIds')
  expect(first.progress).toMatchObject({
    activeDays: 12,
    outreachUsedToday: 4,
    outreachAllowanceToday: 7,
    nextRunAt: 123,
  })
  expect(first.progress).not.toHaveProperty('paused')
  expect(first.progress).not.toHaveProperty('lastLeadListId')
  expect(first.memberships).toEqual([])
  expect(first.worker).toMatchObject({ paused: true, scraperReady: false })
  expect(first.automation?.routine?.outreach).toEqual({
    leadListId: s.leadListId,
    profileIds: [s.profileId],
    message: 'Hello [name]',
  })
  for (const field of [
    'message',
    'leadListId',
    'outreachRoutes',
    'outreachStartDay',
    'dailyIncrease',
  ])
    expect(first.automation?.routine).not.toHaveProperty(field)
  for (const field of ['nodes', 'edges', 'nodeStates', 'currentNodeId'])
    expect(first.automation).not.toHaveProperty(field)
  expect(first.history?.totals).toEqual({
    follows: 4,
    dms: 2,
    warmupMinutes: 5,
    scraperRequests: 6,
  })
  expect(await s.t.mutation(internal.migrations.simplifyAutomation.run, {})).toEqual({
    migrated: false,
  })
  expect(await s.t.run((ctx) => ctx.db.query('analyticsHistory').unique())).toEqual(first.history)
  expect(await s.t.run((ctx) => ctx.db.query('analyticsDays').collect())).toEqual(first.days)
})

test('migration preserves already initialized history without replaying profile counters', async () => {
  const s = await legacyFixture()
  await s.t.run((ctx) =>
    ctx.db.insert('analyticsHistory', {
      startedAt: 123,
      totals: { follows: 100, dms: 20, warmupMinutes: 55, scraperRequests: 6 },
    }),
  )
  await s.t.mutation(internal.migrations.simplifyAutomation.run, {})
  expect(await s.t.run((ctx) => ctx.db.query('analyticsHistory').unique())).toMatchObject({
    startedAt: 123,
    totals: { follows: 100, dms: 20, warmupMinutes: 55, scraperRequests: 6 },
  })
})

test.each(['running', 'models', 'memberships', 'routes', 'graph', 'scraping'] as const)(
  'migration rejects %s conflicts atomically',
  async (reason) => {
    const s = await legacyFixture()
    await s.t.run(async (ctx) => {
      const automation = (await ctx.db.get(s.automationId))!
      if (reason === 'running') await ctx.db.patch(s.automationId, { isActive: true })
      if (reason === 'models' || reason === 'memberships') {
        const modelId = await ctx.db.insert('models', { name: 'Other', createdAt: 1 })
        if (reason === 'models') await ctx.db.patch(s.profileId, { modelIds: [s.modelId, modelId] })
        else await ctx.db.insert('profileModelAssignments', { profileId: s.profileId, modelId })
      }
      if (reason === 'routes')
        await ctx.db.patch(s.automationId, {
          routine: {
            ...automation.routine!,
            outreachRoutes: [
              automation.routine!.outreachRoutes![0],
              automation.routine!.outreachRoutes![0],
            ],
          },
        })
      if (reason === 'graph') await ctx.db.patch(s.automationId, { routine: undefined })
      if (reason === 'scraping')
        await ctx.db.insert('scrapeSources', {
          username: 'source',
          listId: s.leadListId,
          enabled: true,
          running: false,
          nextCheckAt: 0,
          postCount: 0,
          leadsAdded: 0,
          createdAt: 1,
        })
    })
    await expect(s.t.mutation(internal.migrations.simplifyAutomation.run, {})).rejects.toThrow()
    expect((await s.t.run((ctx) => ctx.db.get(s.profileId)))?.modelIds).toBeDefined()
    expect((await s.t.run((ctx) => ctx.db.get(s.automationId)))?.nodes).toEqual([])
    expect(await s.t.run((ctx) => ctx.db.query('analyticsHistory').unique())).toBeNull()
  },
)

test('migration converts the old all-profiles assignment when no routes were saved', async () => {
  const s = await legacyFixture()
  await s.t.run(async (ctx) => {
    const automation = (await ctx.db.get(s.automationId))!
    await ctx.db.patch(s.automationId, {
      routine: { ...automation.routine!, outreachRoutes: undefined },
    })
  })
  await s.t.mutation(internal.migrations.simplifyAutomation.run, {})
  expect((await s.t.run((ctx) => ctx.db.get(s.automationId)))?.routine?.outreach).toEqual({
    leadListId: s.leadListId,
    profileIds: [],
    allProfiles: true,
    message: 'legacy fallback',
  })
})

test('first activity creates totals without a dashboard visit; concurrent actions keep both deltas', async () => {
  const t = createConvexTest()
  expect(await t.mutation(internal.migrations.simplifyAutomation.run, {})).toEqual({
    migrated: false,
  })
  expect(await t.run((ctx) => ctx.db.query('analyticsHistory').unique())).toBeNull()
  const before = await t.query(api.analytics.overview, { date: '2026-10-23', period: 'all' })
  expect(before.totals).toEqual({ follows: 0, dms: 0, warmupMinutes: 0 })
  expect(before.historySince).toBeNull()
  await Promise.all([
    t.run((ctx) => recordActivity(ctx, '2026-10-23', { follows: 1 })),
    t.run((ctx) => recordActivity(ctx, '2026-10-23', { dms: 1 })),
  ])
  expect(
    (await t.query(api.analytics.overview, { date: '2026-10-23', period: 'all' })).totals,
  ).toEqual({ follows: 1, dms: 1, warmupMinutes: 0 })
  expect(await t.run((ctx) => ctx.db.query('analyticsHistory').collect())).toHaveLength(1)
})
