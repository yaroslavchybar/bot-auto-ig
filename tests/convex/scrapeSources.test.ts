import { afterEach, expect, test, vi } from 'vite-plus/test'
import { api, internal } from '../../convex/_generated/api'
import { createConvexTest, seedProfile } from './helpers'

const DAY = 86_400_000
const HOUR = 3_600_000
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

async function setup(options: { limit?: number | null; used?: number; mobileOnly?: boolean } = {}) {
  const t = createConvexTest()
  const { profileId, listId } = await t.run(async (ctx) => {
    const profileId = await ctx.db.insert('profiles', {
      name: 'scraper',
      using: false,
      mode: 'direct',
      createdAt: 0,
      sessionId: options.mobileOnly ? undefined : 'browser-cookie',
      scraperDailyLimit: options.limit,
      scraperUsageCount: options.used ?? 0,
      scraperUsageDate: new Date().toISOString().slice(0, 10),
    })
    if (options.mobileOnly) {
      const storageId = await ctx.storage.store(new Blob(['{}']))
      await ctx.db.insert('chatSessions', { profileId, storageId, token: 'mobile-token' })
    }
    const listId = await ctx.db.insert('leadLists', { name: 'leads', createdAt: 0 })
    return { profileId, listId }
  })
  await t.mutation(api.scrapeSources.add, { listId, links: ['@source'] })
  const sourceId = (await t.query(api.scrapeSources.sources, { listId }))[0]._id
  return { t, profileId, listId, sourceId }
}
type Setup = Awaited<ReturnType<typeof setup>>

test('fractional scraper cooldowns produce integer scheduler deadlines and prevent early claims', async () => {
  vi.stubEnv('INTERNAL_API_KEY', 'test-bridge')
  vi.useFakeTimers()
  const now = Date.parse('2026-10-10T12:00:00Z')
  vi.setSystemTime(now)
  const s = await setup()
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
    leads: 3,
  })
  await s.t.mutation(api.scrapeSources.remove, { sourceId: s.sourceId })
  expect(await s.t.query(api.scrapeSources.summary, { listId: s.listId })).toEqual({
    sources: 0,
    leads: 0,
  })
  expect(await s.t.query(api.leads.getList, { listId: s.listId })).toMatchObject({ name: 'leads' })
  expect(await s.t.query(api.leads.getList, { listId: 'bad-link' })).toBeNull()
})

test('post pages send traffic summaries rather than raw check history', async () => {
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
    averageNewIds: 4,
    likesPerHour: 2,
    checkCount: 10,
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
  expect(claim.kind).toBe('likers')
  return { sourceId: s.sourceId, runId: claim.runId }
}

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

test('mobile-only accounts lose capacity on reconnect; browser cookies remain eligible', async () => {
  vi.stubEnv('INTERNAL_API_KEY', 'test-bridge')
  const s = await setup({ mobileOnly: true })
  expect((await s.t.query(api.scraper.accounts, {}))[0]).toMatchObject({
    ready: true,
    dailyLimit: 1000,
  })
  const claim = (await s.t.mutation(internal.scrapeSources.claim, {}))!
  await s.t.mutation(internal.scrapeSources.finish, {
    sourceId: s.sourceId,
    runId: claim.runId,
    status: 'paused',
  })
  await s.t.run(async (ctx) => {
    const session = await ctx.db
      .query('chatSessions')
      .withIndex('by_profile', (q) => q.eq('profileId', s.profileId))
      .first()
    await ctx.db.patch(session!._id, { reconnectRequired: true })
  })
  expect((await s.t.query(api.scraper.work, { bridgeToken: 'test-bridge' })).taskAt).toBeNull()
  expect(await s.t.mutation(internal.scrapeSources.claim, {})).toBeNull()
  await s.t.run((ctx) => ctx.db.patch(s.profileId, { sessionId: 'browser-cookie' }))
  expect(await s.t.mutation(internal.scrapeSources.claim, {})).toMatchObject({
    profileId: s.profileId,
  })
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
  'monitoring requires a known average strictly above 100 (%s)',
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
    expect(finished.scheduled).toBe(average === 101)
    if (average === 101) {
      expect(finished.nextCheckAt - finished.lastScrapedAt!).toBeGreaterThanOrEqual(HOUR)
      expect(finished.nextCheckAt - finished.lastScrapedAt!).toBeLessThan(2 * HOUR)
    }
  },
)

test('old posts stay monitored past the discovery range and retain check history', async () => {
  const s = await setup()
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
  expect(active.checks).toHaveLength(1)
  expect(active.checks![0].newIds).toBe(10)
})

test('ten quiet successful checks stop monitoring permanently; retries do not count', async () => {
  const s = await setup()
  await discover(s, { average: 200 })
  const post = (await s.t.run((ctx) => ctx.db.query('scrapePosts').collect()))[0]
  let run = await claimLikers(s)
  await s.t.mutation(internal.scrapeSources.finish, {
    ...run,
    status: 'completed',
    newIds: 100,
    likeCount: 200,
  })
  expect((await s.t.run((ctx) => ctx.db.get(post._id)))?.checks).toEqual([])
  for (let i = 0; i < 10; i++) {
    await s.t.run((ctx) =>
      ctx.db.patch(post._id, { nextCheckAt: Date.now() - 1, lastScrapedAt: Date.now() - HOUR }),
    )
    run = await claimLikers(s)
    if (i === 5) {
      await s.t.mutation(internal.scrapeSources.finish, { ...run, status: 'paused' })
      expect((await s.t.run((ctx) => ctx.db.get(post._id)))?.checks).toHaveLength(5)
      run = await claimLikers(s)
    }
    await s.t.mutation(internal.scrapeSources.finish, {
      ...run,
      status: 'completed',
      newIds: 2,
      likeCount: 200,
    })
    expect((await s.t.run((ctx) => ctx.db.get(post._id)))?.scheduled).toBe(i < 9)
  }
  const stopped = (await s.t.run((ctx) => ctx.db.get(post._id)))!
  expect(stopped.checks).toHaveLength(10)
  expect(stopped.monitorStoppedAt).toBeGreaterThan(0)
  await s.t.mutation(api.scrapeSources.checkNow, { sourceId: s.sourceId })
  await discover(s, { average: 999 })
  expect((await s.t.run((ctx) => ctx.db.get(post._id)))?.scheduled).toBe(false)
  expect(await s.t.mutation(internal.scrapeSources.claim, {})).toBeNull()
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

test('quota pauses acknowledge only a prefix and resume at UTC midnight', async () => {
  vi.stubEnv('INTERNAL_API_KEY', 'test-bridge')
  const s = await setup({ used: 999 })
  await discover(s)
  const run = await claimLikers(s)
  expect(
    await s.t.mutation(internal.scraper.saveBatch, {
      ...run,
      likers: [
        { igId: '11', username: 'first' },
        { igId: '12', username: 'second' },
      ],
    }),
  ).toEqual({ added: 1, processed: 1, limitExhausted: true })
  await s.t.mutation(internal.scrapeSources.finish, { ...run, status: 'paused' })
  expect(await s.t.mutation(internal.scrapeSources.claim, {})).toBeNull()
  const midnight = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) + DAY
  expect((await s.t.query(api.scraper.work, { bridgeToken: 'test-bridge' })).taskAt).toBe(midnight)
  await s.t.run((ctx) => ctx.db.patch(s.profileId, { scraperUsageDate: '2000-01-01' }))
  const resumed = await claimLikers(s)
  expect(
    await s.t.mutation(internal.scraper.saveBatch, {
      ...resumed,
      likers: [
        { igId: '11', username: 'first' },
        { igId: '12', username: 'second' },
      ],
    }),
  ).toEqual({ added: 1, processed: 2, limitExhausted: false })
  expect((await s.t.run((ctx) => ctx.db.get(s.profileId)))?.scraperUsageCount).toBe(1)
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
  expect((await s.t.run((ctx) => ctx.db.get(s.profileId)))?.scraperUsageCount).toBe(1)
  expect(await s.t.run((ctx) => ctx.db.query('leadMemberships').collect())).toHaveLength(1)
  expect((await s.t.run((ctx) => ctx.db.get(s.sourceId)))?.discovered).toBe(1)
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

test('unlimited accounts keep working and explicit daily limits preserve defaults', async () => {
  const s = await setup({ limit: null, used: 100000 })
  await discover(s)
  const run = await claimLikers(s)
  expect(
    (
      await s.t.mutation(internal.scraper.saveBatch, {
        ...run,
        likers: [{ igId: '11', username: 'lead' }],
      })
    ).limitExhausted,
  ).toBe(false)
  await s.t.mutation(api.scraper.setDailyLimit, { profileId: s.profileId, limit: 5 })
  expect((await s.t.query(api.scraper.accounts, {}))[0]?.dailyLimit).toBe(5)
  await s.t.mutation(api.scraper.setDailyLimit, { profileId: s.profileId })
  expect((await s.t.run((ctx) => ctx.db.get(s.profileId)))?.scraperDailyLimit).toBeNull()
  await expect(
    s.t.mutation(api.scraper.setDailyLimit, { profileId: s.profileId, limit: 0 }),
  ).rejects.toThrow('Limit must')
  const profile = (await seedProfile(s.t))!
  expect(profile.scraperDailyLimit).toBe(1000)
})
