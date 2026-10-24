import { expect, test, vi } from 'vite-plus/test'
import { api, internal } from '../../convex/_generated/api'
import { LeadStatsChanges } from '../../convex/leadStats'
import { createConvexTest } from './helpers'

const read = (t: ReturnType<typeof createConvexTest>) =>
  t.run((ctx) => ctx.db.query('leadStats').unique())

test('new scraper leads count once even when the same liker is saved to another list', async () => {
  const t = createConvexTest()
  await t.mutation(api.leadStats.initialize, {})
  const sources = await t.run(async (ctx) => {
    const profileId = await ctx.db.insert('profiles', {
      name: 'scraper',
      instagramSessionId: 'browser-cookie',
      inUse: false,
      createdAt: 0, })
    const sources = []
    for (const name of ['one', 'two']) {
      const listId = await ctx.db.insert('leadLists', { name, createdAt: 0 })
      await ctx.db.insert('leadListCounts', { listId, count: 0 })
      const sourceId = await ctx.db.insert('scrapeSources', {
        username: name,
        listId,
        profileId,
        enabled: true,
        running: true,
        runKind: 'likers',
        runId: name,
        leaseUntil: Date.now() + 60_000,
        nextCheckAt: 0,
        postCount: 1,
        leadsAdded: 0,
        createdAt: 0, })
      const postId = await ctx.db.insert('scrapePosts', {
        sourceId,
        mediaId: name,
        code: name,
        takenAt: Date.now(),
        scheduled: true,
        monitoring: false,
        nextCheckAt: 0, })
      await ctx.db.patch(sourceId, { currentPostId: postId })
      sources.push({ sourceId, runId: name })
    }
    return sources
  })
  const likers = [{ igId: '123', username: 'liker' }]
  await t.mutation(internal.scraper.saveBatch, { ...sources[0], likers })
  await t.mutation(internal.scraper.saveBatch, { ...sources[0], likers })
  await t.mutation(internal.scraper.saveBatch, { ...sources[1], likers })
  expect((await read(t))?.counts).toEqual({
    total: 1,
    male: 0,
    assigned: 0, })
})

test('initial backfill counts unique people, classification and outreach eligibility', async () => {
  vi.useFakeTimers()
  try {
    const t = createConvexTest()
    await t.run(async (ctx) => {
      const senderId = await ctx.db.insert('profiles', {
        name: 'sender',
        inUse: false,
        createdAt: 0, })
      const base = { createdAt: 0, dmSent: false, followed: false }
      await ctx.db.insert('leads', { ...base, username: 'pending', screeningStatus: 'pending' })
      await ctx.db.insert('leads', {
        ...base,
        username: 'another-pending',
        screeningStatus: 'pending', })
      const leadId = await ctx.db.insert('leads', {
        ...base,
        username: 'male',
        screeningStatus: 'ready',
        classification: 'male', })
      await ctx.db.insert('leads', {
        ...base,
        username: 'assigned',
        screeningStatus: 'ready',
        classification: 'male',
        senderId, })
      await ctx.db.insert('leads', {
        ...base,
        username: 'female',
        screeningStatus: 'ready',
        classification: 'female', })
      await ctx.db.insert('leads', {
        ...base,
        username: 'business',
        screeningStatus: 'ready',
        classification: 'business', })
      await ctx.db.insert('leads', { ...base, username: 'error', screeningStatus: 'error' })
      await ctx.db.insert('leads', {
        ...base,
        username: 'followed',
        screeningStatus: 'ready',
        classification: 'male',
        followed: true, })
      await ctx.db.insert('leads', {
        ...base,
        username: 'sent',
        screeningStatus: 'ready',
        classification: 'male',
        dmSent: true, })
      for (const name of ['one', 'two']) {
        const listId = await ctx.db.insert('leadLists', { name, createdAt: 0 })
        await ctx.db.insert('leadMemberships', {
          leadId,
          listId,
          leadCreatedAt: 0,
          available: true, })
      }
    })
    await t.mutation(api.leadStats.initialize, {})
    await t.mutation(api.leadStats.initialize, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const result = await read(t)
    expect(result).toMatchObject({
      backfillComplete: true,
      counts: { total: 9, male: 4, assigned: 1 }, })
    await t.mutation(api.leadStats.initialize, {})
    expect(await read(t)).toEqual(result)
  } finally {
    vi.useRealTimers()
  }
})

test('backfill restarts after changes across pages even when a batch has zero net delta', async () => {
  vi.useFakeTimers()
  try {
    const t = createConvexTest()
    const ids = await t.run(async (ctx) => {
      for (let i = 0; i < 250; i++)
        await ctx.db.insert('leads', {
          username: String(i),
          createdAt: 0,
          dmSent: false,
          followed: false,
          screeningStatus: 'ready',
          classification: 'female', })
      const rows = await ctx.db.query('leads').collect()
      await ctx.db.patch(rows[0]._id, { classification: 'male' })
      return [rows[0]._id, rows[249]._id]
    })
    await t.mutation(api.leadStats.initialize, {})
    await t.mutation(internal.leadStats.backfill, { cursor: null })
    expect((await read(t))?.counts.total).toBe(200)
    await t.run(async (ctx) => {
      const stats = new LeadStatsChanges()
      for (const [i, id] of ids.entries()) {
        const before = (await ctx.db.get(id))!
        const classification = i === 0 ? ('female' as const) : ('male' as const)
        await ctx.db.patch(id, { classification })
        stats.add(before, { ...before, classification })
      }
      await stats.flush(ctx)
    })
    expect((await read(t))?.dataRevision).toBe(1)
    // Simulate a lost continuation; initialize must resume without double-counting.
    await t.run(async (ctx) => {
      const state = (await ctx.db.query('leadStats').unique())!
      await ctx.scheduler.cancel(state.backfillJobId!)
    })
    await t.mutation(api.leadStats.initialize, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await read(t)).toMatchObject({
      backfillComplete: true,
      counts: { total: 250, male: 1, assigned: 0 }, })
  } finally {
    vi.useRealTimers()
  }
})
