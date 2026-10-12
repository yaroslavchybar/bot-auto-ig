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
      using: false,
      createdAt: 0,
    })
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
        kind: 'likers',
        runId: name,
        leaseUntil: Date.now() + 60_000,
        nextCheckAt: 0,
        postCount: 1,
        discovered: 0,
        createdAt: 0,
      })
      const postId = await ctx.db.insert('scrapePosts', {
        sourceId,
        mediaId: name,
        code: name,
        takenAt: Date.now(),
        scheduled: true,
        monitoring: false,
        nextCheckAt: 0,
      })
      await ctx.db.patch(sourceId, { currentPostId: postId })
      sources.push({ sourceId, runId: name })
    }
    return sources
  })
  await t.run((ctx) => ctx.db.insert('workerMetadataMigration', { cursor: null, complete: true }))
  await t.mutation(api.analytics.initialize, {})
  const likers = [{ igId: '123', username: 'liker' }]
  await t.mutation(internal.scraper.saveBatch, { ...sources[0], likers })
  await t.mutation(internal.scraper.saveBatch, { ...sources[0], likers })
  await t.mutation(internal.scraper.saveBatch, { ...sources[1], likers })
  expect((await read(t))?.counts).toEqual({
    total: 1,
    pending: 1,
    enriched: 0,
    male: 0,
    ready: 0,
    assigned: 0,
  })
  expect(
    (await t.run((ctx) => ctx.db.query('analyticsHistory').unique()))?.totals.scraperUnits,
  ).toBe(0)
})

test('initial backfill counts unique people, classification and outreach eligibility', async () => {
  vi.useFakeTimers()
  try {
    const t = createConvexTest()
    await t.run(async (ctx) => {
      const senderId = await ctx.db.insert('profiles', {
        name: 'sender',
        using: false,
        createdAt: 0,
      })
      const base = { createdAt: 0, dmSent: false, followed: false }
      await ctx.db.insert('leads', { ...base, username: 'pending', enrichmentStatus: 'pending' })
      await ctx.db.insert('leads', {
        ...base,
        username: 'describing',
        enrichmentStatus: 'describing',
      })
      const leadId = await ctx.db.insert('leads', {
        ...base,
        username: 'male',
        enrichmentStatus: 'ready',
        classification: 'male',
      })
      await ctx.db.insert('leads', {
        ...base,
        username: 'assigned',
        enrichmentStatus: 'ready',
        classification: 'male',
        senderId,
      })
      await ctx.db.insert('leads', {
        ...base,
        username: 'female',
        enrichmentStatus: 'ready',
        classification: 'female',
      })
      await ctx.db.insert('leads', {
        ...base,
        username: 'business',
        enrichmentStatus: 'ready',
        classification: 'business',
      })
      await ctx.db.insert('leads', { ...base, username: 'error', enrichmentStatus: 'error' })
      await ctx.db.insert('leads', {
        ...base,
        username: 'followed',
        enrichmentStatus: 'ready',
        classification: 'male',
        followed: true,
      })
      await ctx.db.insert('leads', {
        ...base,
        username: 'sent',
        enrichmentStatus: 'ready',
        classification: 'male',
        dmSent: true,
      })
      for (const name of ['one', 'two']) {
        const listId = await ctx.db.insert('leadLists', { name, createdAt: 0 })
        await ctx.db.insert('leadMemberships', {
          leadId,
          listId,
          leadCreatedAt: 0,
          available: true,
        })
      }
    })
    await t.mutation(api.leadStats.initialize, {})
    await t.mutation(api.leadStats.initialize, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const result = await read(t)
    expect(result).toMatchObject({
      complete: true,
      counts: { total: 9, pending: 2, enriched: 6, male: 4, ready: 1, assigned: 1 },
    })
    await t.mutation(api.leadStats.initialize, {})
    expect(await read(t)).toEqual(result)
  } finally {
    vi.useRealTimers()
  }
})

test('batched classification, retries and saved checkpoints update counts without duplicate increments', async () => {
  vi.useFakeTimers()
  try {
    const t = createConvexTest()
    const ids = await t.run(async (ctx) => {
      const ids = []
      for (const username of ['male', 'female', 'error', 'description'])
        ids.push(
          await ctx.db.insert('leads', {
            username,
            createdAt: 0,
            dmSent: false,
            followed: false,
            enrichmentStatus: 'pending',
          }),
        )
      return ids
    })
    await t.mutation(api.leadStats.initialize, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const batch = {
      entries: [
        { leadId: ids[0], classification: 'male' as const },
        { leadId: ids[1], classification: 'female' as const },
        { leadId: ids[2], error: true as const },
        { leadId: ids[3], description: 'Portrait' },
      ],
    }
    await t.mutation(internal.scraper.saveEnrichmentBatch, batch)
    expect((await read(t))?.counts).toEqual({
      total: 4,
      pending: 1,
      enriched: 2,
      male: 1,
      ready: 1,
      assigned: 0,
    })
    const stable = await read(t)
    await t.mutation(internal.scraper.saveEnrichmentBatch, batch)
    expect(await read(t)).toEqual(stable)
    await t.mutation(internal.scraper.enrichmentError, { leadId: ids[0] })
    expect((await read(t))?.counts).toEqual({
      total: 4,
      pending: 1,
      enriched: 1,
      male: 0,
      ready: 0,
      assigned: 0,
    })
    await t.mutation(api.scraper.retryEnrichment, {})
    expect((await read(t))?.counts.pending).toBe(3)
    await t.mutation(internal.scraper.enrich, { leadId: ids[1], classification: 'male' })
    expect((await read(t))?.counts).toEqual({
      total: 4,
      pending: 3,
      enriched: 1,
      male: 1,
      ready: 1,
      assigned: 0,
    })
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
          enrichmentStatus: 'ready',
          classification: 'female',
        })
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
    expect((await read(t))?.revision).toBe(1)
    // Simulate a lost continuation; initialize must resume without double-counting.
    await t.run(async (ctx) => {
      const state = (await ctx.db.query('leadStats').unique())!
      await ctx.scheduler.cancel(state.jobId!)
    })
    await t.mutation(api.leadStats.initialize, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await read(t)).toMatchObject({
      complete: true,
      counts: { total: 250, pending: 0, enriched: 250, male: 1, ready: 1, assigned: 0 },
    })
  } finally {
    vi.useRealTimers()
  }
})
