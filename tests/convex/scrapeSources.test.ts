import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { api, internal } from '../../convex/_generated/api'
import { createConvexTest } from './helpers'
import { sessionWindow } from '../../convex/scraperRequestPolicy'
import { proxyCountryZones } from '../../convex/proxyCountryZones'
import { patchProfile, syncWorkerProfile } from '../../convex/workerMetadata'

const DAY = 86_400_000
const HOUR = 3_600_000
beforeEach(() => {
  // Time-travel tests must stay in the session's awake window, regardless of the CI clock.
  vi.useFakeTimers()
  vi.setSystemTime(Date.parse('2026-10-12T09:00:00Z'))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

async function setup(
  options: {
    limit?: number | null
    used?: number
    noCookie?: boolean
    monitorDays?: number
  } = {},
) {
  const t = createConvexTest()
  const { profileId, listId } = await t.run(async (ctx) => {
    const profileId = await ctx.db.insert('profiles', {
      name: 'scraper',
      using: false,
      mode: 'direct',
      proxy: 'proxy.test:8000',
      proxyType: 'http',
      createdAt: 0,
      sessionId: options.noCookie ? undefined : 'browser-cookie',
      scraperDailyLimit: options.limit,
      scraperUsageCount: options.used ?? 0,
      scraperUsageDate: new Date().toISOString().slice(0, 10),
    })
    const country = ['gb', 'us', 'jp', 'nz'].find(
      (country) =>
        !sessionWindow(String(profileId), proxyCountryZones[country]!, Date.now()).sleeping,
    )!
    await ctx.db.insert('proxies', {
      name: 'test',
      proxy: 'proxy.test:8000',
      proxyType: 'http',
      country,
      createdAt: 0,
    })
    await syncWorkerProfile(ctx, (await ctx.db.get(profileId))!)
    const listId = await ctx.db.insert('leadLists', {
      name: 'leads',
      createdAt: 0,
      scrapeMonitorDays: options.monitorDays,
    })
    await ctx.db.insert('leadListCounts', { listId, count: 0 })
    return { profileId, listId }
  })
  await t.mutation(api.scrapeSources.add, { listId, links: ['@source'] })
  const sourceId = (await t.query(api.scrapeSources.sources, { listId }))[0]._id
  return { t, profileId, listId, sourceId }
}
type Setup = Awaited<ReturnType<typeof setup>>

test('saving leads never consumes request slots or truncates at an old daily lead limit', async () => {
  const s = await setup({ limit: 1, used: 1 })
  await discover(s)
  const run = await claimLikers(s)
  const likers = Array.from({ length: 25 }, (_, i) => ({
    igId: String(1000 + i),
    username: `lead${i}`,
  }))
  expect(await s.t.mutation(internal.scraper.saveBatch, { ...run, likers })).toMatchObject({
    added: 25,
    processed: 25,
    limitExhausted: false,
  })
  expect(await s.t.run((ctx) => ctx.db.query('leadMemberships').collect())).toHaveLength(25)
  expect(await s.t.run((ctx) => ctx.db.query('scraperRequestUsage').collect())).toEqual([])
})

test('the first successful scrape starts a hard 24-hour cutoff even with an active lease', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.parse('2026-10-12T12:00:00Z'))
  const s = await setup()
  await discover(s, { average: 0, age: 40 * DAY })
  let run = await claimLikers(s)
  await s.t.mutation(internal.scraper.saveBatch, {
    ...run,
    likers: [{ igId: '1000', username: 'retained' }],
  })
  const start = Date.now()
  await s.t.mutation(internal.scrapeSources.finish, { ...run, status: 'completed', newIds: 1 })
  const post = (await s.t.run((ctx) => ctx.db.query('scrapePosts').unique()))!
  expect(post.firstScrapedAt).toBe(start)
  expect(post.nextCheckAt - start).toBeGreaterThanOrEqual(HOUR)
  expect(post.nextCheckAt - start).toBeLessThanOrEqual(3 * HOUR)
  await vi.advanceTimersByTimeAsync(post.nextCheckAt - Date.now())
  await s.t.finishInProgressScheduledFunctions()
  run = await claimLikers(s)
  await s.t.mutation(internal.scrapeSources.finish, { ...run, status: 'completed', newIds: 0 })
  expect((await s.t.run((ctx) => ctx.db.get(post._id)))?.firstScrapedAt).toBe(start)
  // Keep a lease across expiry; no available requests should be needed to stop it.
  await s.t.run(async (ctx) => {
    await ctx.db.patch(s.sourceId, {
      running: true,
      kind: 'likers',
      currentPostId: post._id,
      runId: 'expires',
      leaseUntil: start + DAY + HOUR,
    })
    await patchProfile(ctx, s.profileId, { scraperCooldownUntil: start + 2 * DAY })
  })
  await vi.advanceTimersByTimeAsync(start + DAY - Date.now())
  await s.t.finishInProgressScheduledFunctions()
  expect(await s.t.run((ctx) => ctx.db.get(post._id))).toMatchObject({
    firstScrapedAt: start,
    scheduled: false,
    monitoring: false,
  })
  expect((await s.t.run((ctx) => ctx.db.get(s.sourceId)))?.running).toBe(false)
  expect(await s.t.run((ctx) => ctx.db.query('leads').collect())).toHaveLength(1)
  await expect(
    s.t.mutation(internal.scraper.saveBatch, {
      sourceId: s.sourceId,
      runId: 'expires',
      likers: [],
    }),
  ).rejects.toThrow('no longer active')
})

async function flushImmediate(t: Setup['t']) {
  for (let i = 0; i < 30; i++) {
    await vi.advanceTimersByTimeAsync(1)
    await t.finishInProgressScheduledFunctions()
  }
}

test('fractional scraper cooldowns produce integer scheduler deadlines and prevent early claims', async () => {
  vi.stubEnv('INTERNAL_API_KEY', 'test-bridge')
  vi.useFakeTimers()
  const now = Date.parse('2026-10-10T12:00:00Z')
  vi.setSystemTime(now)
  const s = await setup()
  await discover(s)
  await s.t.mutation(internal.scraper.cooldownAccount, {
    profileId: s.profileId,
    retryAfterMs: 1_800_000.25,
  })
  expect((await s.t.query(api.scraper.work, { bridgeToken: 'test-bridge' })).taskAt).toBe(
    now + 1_800_001,
  )
  vi.setSystemTime(now + 1_800_000)
  expect(await s.t.mutation(internal.scrapeSources.claim, {})).toBeNull()
  vi.setSystemTime(now + 1_800_001)
  expect(await s.t.mutation(internal.scrapeSources.claim, {})).not.toBeNull()
})

test('overview counts are compact and unaffected by worker progress', async () => {
  const s = await setup()
  const before = await s.t.query(api.scrapeSources.summary, { listId: s.listId })
  expect(before).toEqual({ sources: 1, leads: 0 })
  await s.t.run((ctx) =>
    ctx.db.patch(s.sourceId, {
      running: true,
      runId: 'worker',
      leaseUntil: Date.now() + HOUR,
      error: 'retry',
    }),
  )
  expect(await s.t.query(api.scrapeSources.summary, { listId: s.listId })).toEqual(before)
  await s.t.run((ctx) => ctx.db.patch(s.sourceId, { discovered: 3 }))
  expect(await s.t.query(api.scrapeSources.summary, { listId: s.listId })).toEqual({
    sources: 1,
    leads: 0,
  })
  await s.t.mutation(api.scrapeSources.remove, { sourceId: s.sourceId })
  expect(await s.t.query(api.scrapeSources.summary, { listId: s.listId })).toEqual({
    sources: 0,
    leads: 0,
  })
  expect(await s.t.query(api.leads.getList, { listId: s.listId })).toMatchObject({ name: 'leads' })
  expect(await s.t.query(api.leads.getList, { listId: 'bad-link' })).toBeNull()
})

test('post pages omit obsolete check history', async () => {
  const s = await setup()
  await discover(s, { average: 200 })
  const post = (await s.t.run((ctx) => ctx.db.query('scrapePosts').collect()))[0]
  await s.t.run((ctx) =>
    ctx.db.patch(post._id, {
      checks: Array.from({ length: 10 }, (_, i) => ({
        at: i * HOUR,
        elapsedMs: HOUR,
        newIds: 4,
        likesGained: 2,
      })),
    }),
  )
  const result = await s.t.query(api.scrapeSources.posts, {
    sourceId: s.sourceId,
    paginationOpts: { numItems: 50, cursor: null },
  })
  expect(result.page[0]).toMatchObject({
    code: post.code,
    scheduled: true,
  })
  expect(result.page[0]).not.toHaveProperty('checks')
  expect(result.page[0]).not.toHaveProperty('sourceId')
})

async function discover(
  s: Setup,
  options: { average?: number; age?: number; count?: number } = {},
) {
  const claim = (await s.t.mutation(internal.scrapeSources.claim, {}))!
  expect(claim.kind).toBe('posts')
  const run = { sourceId: s.sourceId, runId: claim.runId }
  const posts = Array.from({ length: options.count ?? 1 }, (_, i) => ({
    id: String(i + 1),
    code: `post${i}`,
    takenAt: Date.now() - (options.age ?? HOUR),
    likeCount: options.average,
  }))
  await s.t.mutation(internal.scrapeSources.registerPosts, {
    ...run,
    posts,
    averageLikes: options.average,
    postCount: posts.length,
    postsFromApify: false,
  })
  await s.t.mutation(internal.scrapeSources.finish, {
    ...run,
    status: 'completed',
    newIds: 0,
    likeCount: 200,
  })
  return run
}

async function claimLikers(s: Setup) {
  const claim = (await s.t.mutation(internal.scrapeSources.claim, {}))!
  expect(claim?.kind).toBe('likers')
  return { sourceId: s.sourceId, runId: claim.runId }
}

test('latest-post limit defaults to ten and updates future discovery claims', async () => {
  const s = await setup()
  const first = (await s.t.mutation(internal.scrapeSources.claim, {}))!
  expect(first.postLimit).toBe(10)
  await s.t.mutation(api.scrapeSources.settings, {
    listId: s.listId,
    days: 90,
    monitor: true,
    postLimit: 4,
  })
  expect((await s.t.mutation(internal.scrapeSources.claim, {}))?.postLimit).toBe(4)
  expect((await s.t.run((ctx) => ctx.db.get(s.listId)))?.scrapeMonitorDays).toBe(1)
  for (const postLimit of [0, 1.5, 5001])
    await expect(
      s.t.mutation(api.scrapeSources.settings, {
        listId: s.listId,
        days: 90,
        monitor: true,
        postLimit,
      }),
    ).rejects.toThrow('Post limit')
})

test('deployment cleanup trims newest posts in batches and stops expired monitors without losing leads', async () => {
  vi.useFakeTimers()
  const s = await setup()
  const rows = await s.t.run(async (ctx) => {
    await ctx.db.insert('leads', {
      username: 'collected',
      createdAt: Date.now(),
      dmSent: false,
      followed: false,
    })
    await ctx.db.patch(s.sourceId, { discovered: 42, postCount: 115 })
    const ids = []
    for (let i = 0; i < 115; i++)
      ids.push(
        await ctx.db.insert('scrapePosts', {
          sourceId: s.sourceId,
          mediaId: String(i + 1),
          code: `post${i}`,
          takenAt: Date.now() - (i < 8 ? i * HOUR : (i - 4) * DAY),
          likeCount: 200,
          scheduled: true,
          monitoring: true,
          monitorEligible: true,
          firstScrapedAt: Date.now() - (i < 8 ? HOUR : 2 * DAY),
          lastScrapedAt: Date.now() - HOUR,
          nextCheckAt: Date.now() + HOUR,
        }),
      )
    await ctx.db.patch(s.sourceId, {
      running: true,
      kind: 'likers',
      runId: 'removed',
      currentPostId: ids[110],
      leaseUntil: Date.now() + HOUR,
    })
    return ids
  })
  await s.t.mutation(internal.scrapeSources.trimPosts, { sourceId: s.sourceId })
  await flushImmediate(s.t)
  const posts = await s.t.run((ctx) => ctx.db.query('scrapePosts').collect())
  expect(posts.map((p) => p._id)).toEqual(rows.slice(0, 10))
  expect(posts.filter((p) => p.monitoring)).toHaveLength(8)
  expect(posts.slice(8).every((p) => !p.scheduled)).toBe(true)
  expect(posts.slice(8).every((p) => p.monitorStoppedAt !== undefined)).toBe(true)
  expect(await s.t.run((ctx) => ctx.db.get(s.sourceId))).toMatchObject({
    postCount: 10,
    averageLikes: 200,
    discovered: 42,
    running: false,
  })
  expect(await s.t.run((ctx) => ctx.db.query('leads').collect())).toHaveLength(1)
  // Changing discovery limits cannot revive an expired monitor.
  await s.t.mutation(api.scrapeSources.settings, {
    listId: s.listId,
    days: 90,
    monitor: true,
    postLimit: 9,
  })
  await flushImmediate(s.t)
  expect(await s.t.run((ctx) => ctx.db.query('scrapePosts').collect())).toHaveLength(9)
  expect((await s.t.run((ctx) => ctx.db.get(rows[8])))?.monitoring).toBe(false)
  await s.t.mutation(internal.scrapeSources.trimPosts, { sourceId: s.sourceId })
  await flushImmediate(s.t)
  expect((await s.t.run((ctx) => ctx.db.get(rows[8])))?.monitoring).toBe(false)
})

test('stale trimming continuations cannot delete posts after the limit is increased', async () => {
  vi.useFakeTimers()
  const s = await setup()
  await s.t.run(async (ctx) => {
    for (let i = 0; i < 110; i++)
      await ctx.db.insert('scrapePosts', {
        sourceId: s.sourceId,
        mediaId: String(i),
        code: `post${i}`,
        takenAt: Date.now() - i * HOUR,
        likeCount: 200,
        scheduled: true,
        monitoring: true,
        monitorEligible: true,
        nextCheckAt: Date.now() + HOUR,
      })
  })
  await s.t.mutation(internal.scrapeSources.trimPosts, { sourceId: s.sourceId })
  await s.t.mutation(api.scrapeSources.settings, {
    listId: s.listId,
    days: 90,
    monitor: true,
    postLimit: 100,
  })
  await flushImmediate(s.t)
  // Ten retained prefix rows + ten untouched suffix rows survive the stale cursor.
  expect(await s.t.run((ctx) => ctx.db.query('scrapePosts').collect())).toHaveLength(20)
})

test.each([
  { using: true, status: 'idle' },
  { using: false, status: 'running' },
])('busy browser profiles suspend scraper work and resume when idle (%j)', async (busy) => {
  vi.stubEnv('INTERNAL_API_KEY', 'test-bridge')
  const s = await setup()
  await discover(s)
  await s.t.run((ctx) => patchProfile(ctx, s.profileId, busy))
  expect(await s.t.query(api.scraper.work, { bridgeToken: 'test-bridge' })).toMatchObject({
    taskAt: Date.now() + DAY,
    blockedProfileIds: [s.profileId],
  })
  expect(await s.t.mutation(internal.scrapeSources.claim, {})).toBeNull()
  await s.t.run((ctx) => patchProfile(ctx, s.profileId, { using: false, status: 'idle' }))
  expect(
    (await s.t.query(api.scraper.work, { bridgeToken: 'test-bridge' })).blockedProfileIds,
  ).toEqual([])
  const claim = (await s.t.mutation(internal.scrapeSources.claim, {}))!
  await s.t.run((ctx) => patchProfile(ctx, s.profileId, busy))
  await expect(
    s.t.mutation(internal.scrapeSources.heartbeat, { sourceId: s.sourceId, runId: claim.runId }),
  ).rejects.toThrow('busy in the browser')
})

test('source detail distinguishes live discovery and liker checks with updated timestamps', async () => {
  vi.useFakeTimers()
  const s = await setup()
  await discover(s, { average: 200 })
  const before = (await s.t.query(api.scrapeSources.sources, { listId: s.listId }))[0]
  vi.setSystemTime(Date.now() + 1000)
  const run = await claimLikers(s)
  expect((await s.t.query(api.scrapeSources.sources, { listId: s.listId }))[0]).toMatchObject({
    running: true,
    kind: 'likers',
  })
  await s.t.mutation(internal.scrapeSources.finish, {
    ...run,
    status: 'completed',
    newIds: 4,
    likeCount: 200,
  })
  const after = (await s.t.query(api.scrapeSources.sources, { listId: s.listId }))[0]
  expect(after).toMatchObject({
    running: false,
    lastCheckAt: before.lastCheckAt,
    nextCheckAt: before.nextCheckAt,
    lastLikerCheckAt: Date.now(),
  })
  expect(after.currentPostId).toBeUndefined()
})

test('sources normalize URLs and deduplicate within each list', async () => {
  const s = await setup()
  expect(
    await s.t.mutation(api.scrapeSources.add, {
      listId: s.listId,
      links: ['https://www.instagram.com/Source/', '@source', 'second'],
    }),
  ).toEqual({ created: 1, duplicates: 1 })
  const listId = await s.t.run((ctx) => ctx.db.insert('leadLists', { name: 'other', createdAt: 0 }))
  expect(await s.t.mutation(api.scrapeSources.add, { listId, links: ['source'] })).toEqual({
    created: 1,
    duplicates: 0,
  })
  await expect(
    s.t.mutation(api.scrapeSources.add, {
      listId: s.listId,
      links: ['valid', 'https://evil.test/source'],
    }),
  ).rejects.toThrow('Invalid Instagram')
  expect(
    (await s.t.query(api.scrapeSources.sources, { listId: s.listId })).map((v) => v.username),
  ).toEqual(['second', 'source'])
})

test('a source can be re-added during deletion without cleanup removing its replacement', async () => {
  const s = await setup()
  await s.t.mutation(api.scrapeSources.remove, { sourceId: s.sourceId })
  expect(
    await s.t.mutation(api.scrapeSources.add, { listId: s.listId, links: ['source'] }),
  ).toEqual({
    created: 1,
    duplicates: 0,
  })
  const replacement = (await s.t.query(api.scrapeSources.sources, { listId: s.listId }))[0]
  expect(replacement._id).not.toBe(s.sourceId)
  expect(
    await s.t.mutation(api.scrapeSources.add, { listId: s.listId, links: ['source'] }),
  ).toEqual({
    created: 0,
    duplicates: 1,
  })
  await s.t.mutation(internal.scrapeSources.cleanup, { sourceId: s.sourceId, remove: true })
  expect(await s.t.query(api.scrapeSources.sources, { listId: s.listId })).toEqual([replacement])
})

test('sources awaiting deletion still count toward list capacity', async () => {
  const s = await setup()
  await s.t.mutation(api.scrapeSources.add, {
    listId: s.listId,
    links: Array.from({ length: 50 }, (_, i) => `source${i}`),
  })
  await s.t.mutation(api.scrapeSources.add, {
    listId: s.listId,
    links: Array.from({ length: 49 }, (_, i) => `source${i + 50}`),
  })
  await s.t.mutation(api.scrapeSources.remove, { sourceId: s.sourceId })
  await expect(
    s.t.mutation(api.scrapeSources.add, { listId: s.listId, links: ['source'] }),
  ).rejects.toThrow('A list can have up to 100 source profiles')
  await s.t.mutation(internal.scrapeSources.cleanup, { sourceId: s.sourceId, remove: true })
  expect(
    await s.t.mutation(api.scrapeSources.add, { listId: s.listId, links: ['source'] }),
  ).toEqual({
    created: 1,
    duplicates: 0,
  })
})

test('scraping requires a browser cookie and resumes when it is refreshed', async () => {
  vi.stubEnv('INTERNAL_API_KEY','test-bridge')
  const s=await setup({noCookie:true})
  expect((await s.t.query(api.scraper.accounts,{}))[0].ready).toBe(false)
  await discover(s)
  expect(await s.t.mutation(internal.scrapeSources.claim,{})).toBeNull()
  await s.t.run(ctx=>patchProfile(ctx,s.profileId,{sessionId:'browser-cookie'}))
  expect(await s.t.mutation(internal.scrapeSources.claim,{})).toMatchObject({profileId:s.profileId})
})

test('daily discovery uses a rolling range and durable due times without sending worker state to UI', async () => {
  vi.stubEnv('INTERNAL_API_KEY', 'test-bridge')
  const s = await setup()
  await s.t.mutation(api.scrapeSources.settings, { listId: s.listId, days: 7, monitor: true })
  const before = Date.now()
  const claim = (await s.t.mutation(internal.scrapeSources.claim, {}))!
  expect(claim.sinceDate).toBeGreaterThanOrEqual(before - 7 * DAY)
  await s.t.mutation(internal.scrapeSources.registerPosts, {
    sourceId: s.sourceId,
    runId: claim.runId,
    posts: [],
    postCount: 0,
    postsFromApify: false,
  })
  await s.t.mutation(internal.scrapeSources.finish, {
    sourceId: s.sourceId,
    runId: claim.runId,
    status: 'completed',
    newIds: 0,
    likeCount: 200,
  })
  const source = (await s.t.query(api.scrapeSources.sources, { listId: s.listId }))[0]
  expect(source.nextCheckAt - source.lastCheckAt!).toBe(DAY)
  expect(source).not.toHaveProperty('runId')
  expect(source).not.toHaveProperty('posts')
  expect((await s.t.query(api.scraper.work, { bridgeToken: 'test-bridge' })).taskAt).toBe(
    source.nextCheckAt,
  )
  expect(await s.t.mutation(internal.scrapeSources.claim, {})).toBeNull()
  await s.t.mutation(api.scrapeSources.checkNow, { sourceId: s.sourceId })
  expect((await s.t.mutation(internal.scrapeSources.claim, {}))?.sinceDate).toBeGreaterThanOrEqual(
    claim.sinceDate,
  )
})

test('HTTP bridge accepts Rust null metadata and fences subsequent writes after pause', async () => {
  vi.stubEnv('INTERNAL_API_KEY', 'test-bridge')
  const s = await setup()
  const post = (path: string, data: unknown) =>
    s.t.fetch(`/api/scraper/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-bridge' },
      body: JSON.stringify(data),
    })
  const response = await post('claim', {})
  expect(response.status).toBe(200)
  const claim = await response.json()
  const run = { sourceId: s.sourceId, runId: claim.runId }
  const registration = {
    ...run,
    posts: [{ id: '1', code: 'one', takenAt: Date.now() - HOUR, likeCount: null }],
    averageLikes: null,
    postCount: 1,
    postsFromApify: false,
  }
  expect((await post('posts', registration)).status).toBe(200)
  expect(
    (await s.t.run((ctx) => ctx.db.query('scrapePosts').collect()))[0].likeCount,
  ).toBeUndefined()
  expect(
    (await post('finish', { ...run, status: 'completed', newIds: 0, likeCount: 200 })).status,
  ).toBe(200)
  const next = await (await post('claim', {})).json()
  expect(next.kind).toBe('likers')
  expect(
    (
      await post('finish', {
        sourceId: s.sourceId,
        runId: next.runId,
        status: 'completed',
        newIds: 100,
        likeCount: null,
      })
    ).status,
  ).toBe(200)
  expect(
    (await s.t.run((ctx) => ctx.db.query('scrapePosts').collect()))[0].observedLikeCount,
  ).toBeUndefined()
  await s.t.mutation(api.scrapeSources.setEnabled, { sourceId: s.sourceId, enabled: false })
  expect((await post('posts', registration)).status).toBeGreaterThanOrEqual(400)
})

test.each([100, 101, undefined])(
  'monitoring applies regardless of average likes (%s)',
  async (average) => {
    const s = await setup()
    await discover(s, { average })
    const post = (await s.t.run((ctx) => ctx.db.query('scrapePosts').collect()))[0]
    expect(post.monitoring).toBe(false)
    if (average === 101) {
      expect(post.monitorEligible).toBe(true)
    }
    const run = await claimLikers(s)
    await s.t.mutation(internal.scrapeSources.finish, {
      ...run,
      status: 'completed',
      newIds: 0,
      likeCount: 200,
    })
    const finished = (await s.t.run((ctx) => ctx.db.get(post._id)))!
    expect(finished.scheduled).toBe(true)
    if (average === 101) {
      expect(finished.nextCheckAt - finished.lastScrapedAt!).toBeGreaterThanOrEqual(HOUR)
      expect(finished.nextCheckAt - finished.lastScrapedAt!).toBeLessThanOrEqual(3 * HOUR)
    }
  },
)

test('old posts stay monitored past the discovery range for a full day from first scrape', async () => {
  const s = await setup({ monitorDays: 7 })
  await discover(s, { average: 500, age: 4 * DAY })
  const post = (await s.t.run((ctx) => ctx.db.query('scrapePosts').collect()))[0]
  let run = await claimLikers(s)
  await s.t.mutation(internal.scrapeSources.finish, {
    ...run,
    status: 'completed',
    newIds: 80,
    likeCount: 500,
  })
  await s.t.run(async (ctx) => {
    await ctx.db.patch(s.listId, { scrapeLookbackDays: 1 })
    await ctx.db.patch(post._id, { nextCheckAt: Date.now() - 1, lastScrapedAt: Date.now() - HOUR })
  })
  run = await claimLikers(s)
  await s.t.mutation(internal.scrapeSources.finish, {
    ...run,
    status: 'completed',
    newIds: 10,
    likeCount: 550,
  })
  const active = (await s.t.run((ctx) => ctx.db.get(post._id)))!
  expect(active.scheduled).toBe(true)
  expect(active.firstScrapedAt).toBeDefined()
  expect(active.firstScrapedAt).toBeLessThanOrEqual(active.lastScrapedAt!)
})

test('due monitoring takes priority over discovery and initial scraping backlogs', async () => {
  const s = await setup()
  await discover(s, { average: 200, count: 2 })
  const run = await claimLikers(s)
  await s.t.mutation(internal.scrapeSources.finish, {
    ...run,
    status: 'completed',
    newIds: 0,
    likeCount: 200,
  })
  const post = (await s.t.run((ctx) => ctx.db.query('scrapePosts').collect())).find(
    (p) => p.lastScrapedAt,
  )!
  await s.t.run((ctx) => ctx.db.patch(post._id, { nextCheckAt: Date.now() - 1 }))
  await s.t.mutation(api.scrapeSources.add, { listId: s.listId, links: ['another'] })
  const next = (await s.t.mutation(internal.scrapeSources.claim, {}))!
  expect(next._id).toBe(s.sourceId)
  expect(next.kind).toBe('likers')
  expect(next.post?.id).toBe(post.mediaId)
})

test('expired leases are reclaimed and stale workers cannot write or finish', async () => {
  const s = await setup()
  await discover(s)
  const old = await claimLikers(s)
  await s.t.run((ctx) => ctx.db.patch(s.sourceId, { leaseUntil: Date.now() - 1 }))
  const fresh = await claimLikers(s)
  expect(fresh.runId).not.toBe(old.runId)
  await expect(s.t.mutation(internal.scraper.saveBatch, { ...old, likers: [] })).rejects.toThrow(
    'no longer active',
  )
  await s.t.mutation(internal.scrapeSources.finish, {
    ...old,
    status: 'completed',
    newIds: 0,
    likeCount: 200,
  })
  expect((await s.t.run((ctx) => ctx.db.get(s.sourceId)))?.runId).toBe(fresh.runId)
})

test('repeated accounts and lost-response retries do not duplicate memberships or quota', async () => {
  const s = await setup()
  await discover(s, { average: 200 })
  const run = await claimLikers(s)
  const batch = { ...run, likers: [{ igId: '9007199254740993', username: 'lead' }] }
  expect((await s.t.mutation(internal.scraper.saveBatch, batch)).added).toBe(1)
  expect(await s.t.mutation(internal.scraper.saveBatch, batch)).toEqual({
    added: 0,
    processed: 1,
    limitExhausted: false,
  })
  expect((await s.t.run((ctx) => ctx.db.get(s.profileId)))?.scraperUsageCount).toBe(0)
  expect(await s.t.run((ctx) => ctx.db.query('leadMemberships').collect())).toHaveLength(1)
  expect((await s.t.run((ctx) => ctx.db.get(s.sourceId)))?.discovered).toBe(1)
})

test('private-profile setting persists, reaches workers, and fences old runs without extra writes', async () => {
  const s = await setup()
  await discover(s, { average: 200 })
  const old = (await s.t.mutation(internal.scrapeSources.claim, {}))!
  expect(old.includePrivate).toBe(false)
  const settings = { listId: s.listId, days: 90, monitor: true, includePrivate: true }
  await s.t.mutation(api.scrapeSources.settings, settings)
  expect((await s.t.query(api.leads.getList, { listId: s.listId }))?.scrapeIncludePrivate).toBe(
    true,
  )
  await expect(
    s.t.mutation(internal.scraper.saveBatch, {
      sourceId: s.sourceId,
      runId: old.runId,
      likers: [],
    }),
  ).rejects.toThrow('no longer active')
  const next = (await s.t.mutation(internal.scrapeSources.claim, {}))!
  expect(next.includePrivate).toBe(true)
  await s.t.mutation(api.scrapeSources.settings, settings)
  expect((await s.t.run((ctx) => ctx.db.get(s.sourceId)))?.runId).toBe(next.runId)
  // Saving other settings does not accidentally reset this preference.
  await s.t.mutation(api.scrapeSources.settings, { listId: s.listId, days: 30, monitor: true })
  expect((await s.t.query(api.leads.getList, { listId: s.listId }))?.scrapeIncludePrivate).toBe(
    true,
  )
  await s.t.mutation(api.scrapeSources.settings, { ...settings, includePrivate: false })
  expect((await s.t.mutation(internal.scrapeSources.claim, {}))?.includePrivate).toBe(false)
})

test('range changes and pause fence workers; resume discovers posts again', async () => {
  const s = await setup()
  await discover(s, { average: 200, age: 4 * DAY })
  const run = await claimLikers(s)
  await s.t.mutation(api.scrapeSources.settings, { listId: s.listId, days: 1, monitor: false })
  await expect(s.t.mutation(internal.scraper.saveBatch, { ...run, likers: [] })).rejects.toThrow(
    'no longer active',
  )
  await s.t.mutation(api.scrapeSources.setEnabled, { sourceId: s.sourceId, enabled: false })
  await s.t.mutation(internal.scrapeSources.cleanup, { sourceId: s.sourceId, remove: false })
  expect(await s.t.mutation(internal.scrapeSources.claim, {})).toBeNull()
  await s.t.mutation(api.scrapeSources.setEnabled, { sourceId: s.sourceId, enabled: true })
  expect((await s.t.mutation(internal.scrapeSources.claim, {}))?.kind).toBe('posts')
})

test('resuming restores older monitored posts independently of discovery without extending their expiry', async () => {
  vi.useFakeTimers()
  const s = await setup({ monitorDays: 7 })
  await discover(s, { average: 500, age: 4 * DAY })
  await s.t.mutation(internal.scrapeSources.finish, {
    ...(await claimLikers(s)),
    status: 'completed',
    newIds: 80,
    likeCount: 500,
  })
  const post = (await s.t.run((ctx) => ctx.db.query('scrapePosts').collect()))[0]
  await s.t.run(async (ctx) => {
    await ctx.db.patch(s.listId, { scrapeLookbackDays: 1 })
    await ctx.db.patch(post._id, { nextCheckAt: Date.now() - 1 })
  })
  await s.t.mutation(api.scrapeSources.setEnabled, { sourceId: s.sourceId, enabled: false })
  await flushImmediate(s.t)
  expect(await s.t.mutation(internal.scrapeSources.claim, {})).toBeNull()
  vi.stubEnv('INTERNAL_API_KEY', 'test-bridge')
  expect((await s.t.query(api.scraper.work, { bridgeToken: 'test-bridge' })).taskAt).toBeNull()
  await s.t.mutation(api.scrapeSources.setEnabled, { sourceId: s.sourceId, enabled: true })
  await flushImmediate(s.t)
  await s.t.mutation(internal.scrapeSources.finish, {
    ...(await claimLikers(s)),
    status: 'completed',
    newIds: 5,
    likeCount: 505,
  })
  await discover(s, { count: 0 }) // Discovery excludes the old post.
  const restored = (await s.t.run((ctx) => ctx.db.get(post._id)))!
  expect(restored).toMatchObject({ scheduled: true, monitoring: true })
  expect(restored.firstScrapedAt).toBe(post.firstScrapedAt)
  vi.setSystemTime(restored.nextCheckAt)
  await claimLikers(s)
})

test('turning list monitoring back on restores older hot posts without extending their expiry', async () => {
  vi.useFakeTimers()
  const s = await setup({ monitorDays: 7 })
  await discover(s, { average: 500, age: 4 * DAY })
  await s.t.mutation(internal.scrapeSources.finish, {
    ...(await claimLikers(s)),
    status: 'completed',
    newIds: 80,
    likeCount: 500,
  })
  const post = (await s.t.run((ctx) => ctx.db.query('scrapePosts').collect()))[0]
  vi.setSystemTime(post.nextCheckAt)
  await s.t.mutation(internal.scrapeSources.finish, {
    ...(await claimLikers(s)),
    status: 'completed',
    newIds: 8,
    likeCount: 508,
  })
  await s.t.run((ctx) => ctx.db.patch(post._id, { nextCheckAt: Date.now() - 1 }))
  await s.t.mutation(api.scrapeSources.settings, { listId: s.listId, days: 1, monitor: false })
  await discover(s, { count: 0 }) // The disabled monitor is removed from the due queue.
  expect((await s.t.run((ctx) => ctx.db.get(post._id)))?.scheduled).toBe(false)
  await s.t.mutation(api.scrapeSources.settings, { listId: s.listId, days: 1, monitor: true })
  await flushImmediate(s.t)
  const restored = (await s.t.run((ctx) => ctx.db.get(post._id)))!
  expect(restored).toMatchObject({ monitoring: true, scheduled: true })
  await claimLikers(s)
})

test('monitor restoration survives discovery while disabled and posts aging outside the range', async () => {
  vi.useFakeTimers()
  const s = await setup()
  await s.t.mutation(api.scrapeSources.settings, { listId: s.listId, days: 1, monitor: true })
  await discover(s, { average: 500, age: 20 * HOUR })
  await s.t.mutation(internal.scrapeSources.finish, {
    ...(await claimLikers(s)),
    status: 'completed',
    newIds: 10,
    likeCount: 500,
  })
  const post = (await s.t.run((ctx) => ctx.db.query('scrapePosts').collect()))[0]
  await s.t.mutation(api.scrapeSources.settings, { listId: s.listId, days: 1, monitor: false })
  await discover(s, { average: 500, age: 20 * HOUR })
  expect(await s.t.run((ctx) => ctx.db.get(post._id))).toMatchObject({
    monitoring: false,
    scheduled: false,
    monitorEligible: true,
  })
  vi.setSystemTime(Date.now() + 8 * HOUR)
  await s.t.mutation(api.scrapeSources.settings, { listId: s.listId, days: 1, monitor: true })
  await flushImmediate(s.t)
  expect(await s.t.run((ctx) => ctx.db.get(post._id))).toMatchObject({
    monitoring: true,
    scheduled: true,
    nextCheckAt: post.nextCheckAt,
  })
  await claimLikers(s)
})

test('saved list counts survive source removal and do not count duplicate imports twice', async () => {
  const s = await setup()
  await discover(s)
  const run = await claimLikers(s)
  const likers = [
    { igId: '11', username: 'one' },
    { igId: '22', username: 'two' },
  ]
  await s.t.mutation(internal.scraper.saveBatch, { ...run, likers })
  await s.t.mutation(internal.scraper.saveBatch, { ...run, likers })
  expect(await s.t.query(api.scrapeSources.summary, { listId: s.listId })).toEqual({
    sources: 1,
    leads: 2,
  })
  await s.t.mutation(api.scrapeSources.remove, { sourceId: s.sourceId })
  expect(await s.t.query(api.scrapeSources.summary, { listId: s.listId })).toEqual({
    sources: 0,
    leads: 2,
  })
  await s.t.mutation(internal.scrapeSources.cleanup, { sourceId: s.sourceId, remove: true })
  expect(await s.t.query(api.scrapeSources.summary, { listId: s.listId })).toEqual({
    sources: 0,
    leads: 2,
  })
  expect(
    (
      await s.t.query(api.leads.listPage, {
        listId: s.listId,
        paginationOpts: { cursor: null, numItems: 100 },
      })
    ).page,
  ).toHaveLength(2)
})

test('turning list monitoring back on leaves paused sources and stopped posts inactive', async () => {
  vi.useFakeTimers()
  const s = await setup()
  await s.t.mutation(api.scrapeSources.add, { listId: s.listId, links: ['paused'] })
  const paused = (await s.t.query(api.scrapeSources.sources, { listId: s.listId })).find(
    (p) => p.username === 'paused',
  )!
  await s.t.mutation(api.scrapeSources.setEnabled, { sourceId: paused._id, enabled: false })
  await flushImmediate(s.t)
  await s.t.run(async (ctx) => {
    for (const sourceId of [s.sourceId, paused._id])
      await ctx.db.insert('scrapePosts', {
        sourceId,
        mediaId: String(sourceId),
        code: 'post',
        takenAt: Date.now() - 4 * DAY,
        nextCheckAt: Date.now() - 1,
        lastScrapedAt: Date.now() - HOUR,
        scheduled: false,
        monitoring: true,
        monitorEligible: true,
        firstScrapedAt: sourceId === s.sourceId ? Date.now() - 2 * DAY : Date.now() - HOUR,
      })
  })
  await s.t.mutation(api.scrapeSources.settings, { listId: s.listId, days: 1, monitor: false })
  await s.t.mutation(api.scrapeSources.settings, { listId: s.listId, days: 1, monitor: true })
  await flushImmediate(s.t)
  expect(
    (await s.t.run((ctx) => ctx.db.query('scrapePosts').collect())).some((p) => p.scheduled),
  ).toBe(false)
  expect((await s.t.run((ctx) => ctx.db.get(paused._id)))?.enabled).toBe(false)
})

test('resume restores monitoring in bounded batches without restarting stopped posts', async () => {
  vi.useFakeTimers()
  const s = await setup({ monitorDays: 90 })
  await s.t.run(async (ctx) => {
    for (let i = 0; i < 105; i++)
      await ctx.db.insert('scrapePosts', {
        sourceId: s.sourceId,
        mediaId: String(i),
        code: `post${i}`,
        takenAt: Date.now() - 80 * DAY,
        nextCheckAt: Date.now() - 1,
        scheduled: true,
        monitoring: true,
        monitorEligible: true,
        lastScrapedAt: Date.now() - HOUR,
        firstScrapedAt: i === 0 ? Date.now() - 2 * DAY : Date.now() - HOUR,
      })
  })
  await s.t.mutation(api.scrapeSources.setEnabled, { sourceId: s.sourceId, enabled: false })
  await flushImmediate(s.t)
  expect(
    (await s.t.run((ctx) => ctx.db.query('scrapePosts').collect())).some((p) => p.scheduled),
  ).toBe(false)
  await s.t.mutation(api.scrapeSources.setEnabled, { sourceId: s.sourceId, enabled: true })
  await flushImmediate(s.t)
  const posts = await s.t.run((ctx) => ctx.db.query('scrapePosts').collect())
  expect(posts.filter((p) => p.scheduled)).toHaveLength(104)
  expect(posts.find((p) => p.mediaId === '0')?.scheduled).toBe(false)
})

test.each(['pause', 'monitor disabled'] as const)(
  'queued monitor restoration respects %s',
  async (change) => {
    vi.useFakeTimers()
    const s = await setup()
    await discover(s, { average: 500 })
    await s.t.mutation(internal.scrapeSources.finish, {
      ...(await claimLikers(s)),
      status: 'completed',
      newIds: 80,
      likeCount: 500,
    })
    await s.t.mutation(api.scrapeSources.setEnabled, { sourceId: s.sourceId, enabled: false })
    await flushImmediate(s.t)
    await s.t.mutation(api.scrapeSources.setEnabled, { sourceId: s.sourceId, enabled: true })
    if (change === 'pause')
      await s.t.mutation(api.scrapeSources.setEnabled, { sourceId: s.sourceId, enabled: false })
    else
      await s.t.mutation(api.scrapeSources.settings, { listId: s.listId, days: 90, monitor: false })
    await flushImmediate(s.t)
    expect((await s.t.run((ctx) => ctx.db.query('scrapePosts').collect()))[0].scheduled).toBe(false)
  },
)

test('removing sources and lists cancels work and retains collected leads', async () => {
  const s = await setup()
  await discover(s)
  const run = await claimLikers(s)
  await s.t.mutation(internal.scraper.saveBatch, {
    ...run,
    likers: [{ igId: '11', username: 'lead' }],
  })
  await s.t.mutation(api.scrapeSources.remove, { sourceId: s.sourceId })
  await s.t.mutation(internal.scrapeSources.cleanup, { sourceId: s.sourceId, remove: true })
  expect(await s.t.run((ctx) => ctx.db.get(s.sourceId))).toBeNull()
  expect(await s.t.run((ctx) => ctx.db.query('scrapePosts').collect())).toHaveLength(0)
  expect(await s.t.run((ctx) => ctx.db.query('leads').collect())).toHaveLength(1)
  expect(await s.t.run((ctx) => ctx.db.query('leadMemberships').collect())).toHaveLength(1)
  await s.t.mutation(api.scrapeSources.add, { listId: s.listId, links: ['other'] })
  await s.t.mutation(internal.leads.deleteList, { listId: s.listId })
  await s.t.mutation(internal.scrapeSources.cleanupList, { listId: s.listId })
  expect((await s.t.run((ctx) => ctx.db.query('scrapeSources').collect()))[0].enabled).toBe(false)
})
