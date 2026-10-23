import { afterEach, expect, test, vi } from 'vite-plus/test'
import { api, internal } from '../../convex/_generated/api'
import { advanceTestClock, createConvexTest, seedAutomation } from './helpers'
import { syncWorkerProfile } from '../../convex/workerMetadata'
import { defaultRoutine } from '../../convex/routinePolicy'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

async function setup() {
  vi.useFakeTimers()
  vi.setSystemTime(Date.parse('2026-10-12T12:00:00Z'))
  vi.stubEnv('INTERNAL_API_KEY', 'test')
  const t = createConvexTest()
  const ids = await t.run(async (ctx) => {
    const modelId = await ctx.db.insert('models', { name: 'model', createdAt: 0 })
    const profileId = await ctx.db.insert('profiles', {
      name: 'profile',
      inUse: false,
      igLoggedIn: true,
      instagramSessionId: 'saved-cookie',
      createdAt: 0,
      proxy: 'http://proxy.test:8000',
      proxyType: 'http',
      modelIds: [modelId],
    })
    await ctx.db.insert('proxies', {
      name: 'proxy',
      proxy: 'http://proxy.test:8000',
      proxyType: 'http',
      country: 'ua',
      createdAt: 0,
    })
    await ctx.db.insert('profileModelAssignments', { profileId, modelId: modelId })
    await syncWorkerProfile(ctx, (await ctx.db.get(profileId))!)
    const listId = await ctx.db.insert('leadLists', { name: 'leads', createdAt: 0 })
    const sourceId = await ctx.db.insert('scrapeSources', {
      username: 'source',
      listId,
      enabled: true,
      running: true,
      profileId,
      runKind: 'likers',
      runId: 'old-run',
      leaseUntil: Date.now() + 60_000,
      nextCheckAt: 0,
      postCount: 1,
      leadsAdded: 0,
      createdAt: 0,
    })
    const postId = await ctx.db.insert('scrapePosts', {
      sourceId,
      mediaId: '1',
      code: 'one',
      takenAt: Date.now(),
      scheduled: true,
      monitoring: false,
      nextCheckAt: 0,
    })
    await ctx.db.patch(sourceId, { currentPostId: postId })
    return { profileId, modelId, sourceId, postId }
  })
  const automation = (await seedAutomation(t, { modelIds: [ids.modelId], routine: defaultRoutine }))!
  const pause = (paused: boolean) =>
    t.mutation(api.profiles.mutations.setPaused, { profileId: ids.profileId, paused })
  const reserve = (requestId: string) =>
    t.mutation(internal.scraperRequests.reserve, { profileId: ids.profileId, requestId })
  return { t, ...ids, automation, pause, reserve }
}

test('pause blocks automation, scraping, warm-up, and browser-cookie calls while preserving login and quota', async () => {
  const s = await setup()
  const args = { bridgeToken: 'test', automationId: s.automation._id, profileId: s.profileId }
  expect(await s.t.query(api.routines.access, args)).toBe(true)
  for (let i = 0; i < 10; i++) expect((await s.reserve(`request-${i}`)).allowed).toBe(true)
  await s.pause(true)
  expect(await s.t.query(api.routines.access, args)).toBe(false)
  expect(
    await s.t.query(api.profiles.queries.automationAccess, {
      bridgeToken: 'test',
      profileId: s.profileId,
    }),
  ).toBe(false)
  const discovery=(await s.t.mutation(internal.scrapeSources.claim, {}))!
  expect(discovery).toMatchObject({runKind:'posts',profileId:''})
  await s.t.mutation(internal.scrapeSources.finish,{sourceId:s.sourceId,runId:discovery.runId,status:'completed'})
  await expect(
    s.t.mutation(internal.scraper.saveBatch, {
      sourceId: s.sourceId,
      runId: 'old-run',
      likers: [],
    }),
  ).rejects.toThrow('no longer active')
  expect(await s.reserve('request-0')).toMatchObject({
    allowed: false,
    reason: 'Profile is paused',
  })
  expect(
    await s.t.mutation(internal.warmup.mutations.beginRunInternal, {
      profileId: s.profileId,
      automationId: String(s.automation._id),
      runId: 'paused-run',
      minMinutes: 10,
      maxMinutes: 20,
      sessionMinMinutes: 5,
      sessionMaxMinutes: 10,
      restMinMinutes: 60,
      restMaxMinutes: 120,
    }),
  ).toMatchObject({ minutes: 0 })
  expect(await s.t.run((ctx) => ctx.db.query('warmupStates').unique())).toBeNull()
  expect(
    (await s.t.query(api.profiles.queries.listPage, { search: '', cursor: null, pageSize: 25 }))
      .page[0].paused,
  ).toBe(true)
  expect((await s.t.query(api.scraper.accounts, {}))[0]).toMatchObject({
    paused: true,
    ready: false,
    used: 10,
  })
  expect(await s.t.run((ctx) => ctx.db.get(s.postId))).toMatchObject({ scheduled: true })
  await s.pause(false)
  expect(await s.t.query(api.routines.access, args)).toBe(true)
  expect(await s.reserve('no-reset')).toMatchObject({
    allowed: false,
    reason: 'Hourly scraper request limit reached',
  })
  vi.setSystemTime(await advanceTestClock(s.t) + 3_600_000)
  expect((await s.reserve('next-hour')).allowed).toBe(true)
  expect((await s.t.mutation(internal.scrapeSources.claim, {}))?.profileId).toBe(s.profileId)
})

test('automation pause controls and the profile menu share one persistent flag', async () => {
  const s = await setup()
  await s.t.run((ctx) =>
    ctx.db.insert('igAccounts', {
      usernameHash: 'account',
      ciphertext: 'encrypted',
      profileId: s.profileId,
      status: 'assigned',
      createdAt: 0,
    }),
  )
  const loginWork = () => s.t.query(api.igAccounts.loginWork, { bridgeToken: 'test' })
  expect(await loginWork()).toHaveLength(1)
  await s.t.mutation(api.routines.setAccount, { profileId: s.profileId, paused: true })
  expect((await s.t.run((ctx) => ctx.db.get(s.profileId)))?.paused).toBe(true)
  expect(await loginWork()).toEqual([])
  await s.pause(false)
  expect((await s.t.run((ctx) => ctx.db.query('accountProgress').unique()))?.paused).toBe(false)
  expect(await loginWork()).toHaveLength(1)
  await s.pause(true)
  await s.t.mutation(api.routines.setAccount, { profileId: s.profileId, paused: false })
  expect((await s.t.run((ctx) => ctx.db.get(s.profileId)))?.paused).toBe(false)
})
