import { afterEach, expect, test, vi } from 'vite-plus/test'
import { api, internal } from '../../convex/_generated/api'
import { addMembership } from '../../convex/leadMemberships'
import { createConvexTest } from './helpers'

afterEach(() => vi.useRealTimers())

test('new list counts remain unique and independent across lists', async () => {
  const t = createConvexTest()
  const first = await t.mutation(api.leads.createList, { name: 'First' })
  const second = await t.mutation(api.leads.createList, { name: 'Second' })
  const metadata = await t.query(api.leads.lists, {})
  await t.run(async ctx => {
    const lead = await ctx.db.insert('leads', { username: 'one', dmSent: false, followed: false, createdAt: 0 })
    await addMembership(ctx, lead, first, 0, false)
    await addMembership(ctx, lead, first, 0, true)
    await addMembership(ctx, lead, second, 0, false)
  })
  expect((await t.query(api.scrapeSources.summary, { listId: first })).leads).toBe(1)
  expect((await t.query(api.scrapeSources.summary, { listId: second })).leads).toBe(1)
  expect(await t.query(api.leads.lists, {})).toEqual(metadata)
})

test('existing lists backfill in bounded pages and restart after concurrent membership inserts', async () => {
  vi.useFakeTimers()
  const t = createConvexTest()
  const listId = await t.run(async ctx => {
    const list = await ctx.db.insert('leadLists', { name: 'Existing', createdAt: 0 })
    for (let i = 0; i < 205; i++) {
      const lead = await ctx.db.insert('leads', { username: `user${i}`, dmSent: false, followed: false, createdAt: i })
      await ctx.db.insert('leadMemberships', { leadId: lead, listId: list, available: false, leadCreatedAt: i })
    }
    return list
  })
  expect((await t.query(api.scrapeSources.summary, { listId })).leads).toBeNull()
  await t.mutation(api.leads.ensureCount, { listId })
  await t.mutation(api.leads.ensureCount, { listId })
  expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())).toHaveLength(1)
  await t.mutation(internal.leads.backfillCount, { listId, count: 0, revision: 0 })
  expect((await t.query(api.scrapeSources.summary, { listId })).leads).toBeNull()
  await t.run(async ctx => {
    const lead = await ctx.db.insert('leads', { username: 'concurrent', dmSent: false, followed: false, createdAt: -1 })
    await addMembership(ctx, lead, listId, -1, false)
  })
  await t.finishAllScheduledFunctions(() => vi.runAllTimers())
  expect((await t.query(api.scrapeSources.summary, { listId })).leads).toBe(206)
  expect(await t.run(ctx => ctx.db.query('leadListCounts').unique())).not.toHaveProperty('revision')
  await t.mutation(api.leads.ensureCount, { listId })
  expect((await t.query(api.scrapeSources.summary, { listId })).leads).toBe(206)
})

test('queued count backfills safely stop if their list is deleted', async () => {
  vi.useFakeTimers()
  const t = createConvexTest()
  const listId = await t.run(ctx => ctx.db.insert('leadLists', { name: 'Existing', createdAt: 0 }))
  await t.mutation(api.leads.ensureCount, { listId })
  await t.mutation(internal.leads.deleteList, { listId })
  await t.finishAllScheduledFunctions(() => vi.runAllTimers())
  expect(await t.run(ctx => ctx.db.get(listId))).toBeNull()
  expect(await t.run(ctx => ctx.db.query('leadListCounts').collect())).toEqual([])
})
