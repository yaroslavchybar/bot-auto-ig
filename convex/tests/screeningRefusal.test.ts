import { afterEach, expect, test, vi } from 'vite-plus/test'
import { api, internal } from '../_generated/api'
import { defaultRoutine, dayKey } from '../routinePolicy'
import { leadAvailable, addMembership } from '../leadMemberships'
import { createConvexTest, seedModel, seedProfile } from '../../tests/convex/helpers'

afterEach(() => vi.useRealTimers())

async function setup() {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-20T12:00:00Z'))
  const t = createConvexTest()
  const list = (await seedModel(t))!, profile = (await seedProfile(t))!
  await t.mutation(api.profiles.mutations.bulkAddToModel, { profileIds: [profile._id], modelId: list._id })
  const leadListId = await t.mutation(api.leads.createList, { name: 'Recipients' })
  const automation = (await t.mutation(api.automations.mutations.create, {
    name: 'Daily', nodes: [], edges: [], modelIds: [list._id],
    routine: { ...defaultRoutine, initialDms: 2, maxDms: 3, outreachEnabled: true, leadListId, message: 'Hello {{username}}' },
  }))!
  await t.mutation(api.automations.mutations.setActive, { id: automation._id, isActive: true })
  await t.mutation(api.profiles.mutations.setIgState, { profileId: profile._id, igLoggedIn: true })
  await t.run(async ctx => {
    await ctx.db.patch(profile._id, { outreachReady: true })
    const warmup = await ctx.db.query('warmupStates').withIndex('by_profile', q => q.eq('profileId', profile._id)).unique()
    const state = { profileId: profile._id, day: 8, date: dayKey(), runsToday: 1, todayMinutes: 30,
      minutesUsedToday: 0 }
    if (warmup) await ctx.db.patch(warmup._id, state)
    else await ctx.db.insert('warmupStates', state)
    const createdAt = Date.now()
    const leadId = await ctx.db.insert('leads', { username: 'target', screeningStatus: 'pending', dmSent: false, followed: false, createdAt })
    await ctx.db.insert('leadMemberships', { leadId, listId: leadListId, available: true, leadCreatedAt: createdAt })
  })
  const args = { automationId: automation._id, profileId: profile._id }
  const claim = (await t.mutation(internal.routines.reserve, args))!
  return { t, args, claim, failure: { ...args, leadId: claim.leadId, date: claim.date, screeningToken: claim.screeningToken } }
}

test.each([false, true])('a first refusal permanently excludes every membership, preserves prior decisions and consumes no quota (saved=%s)', async saved => {
  const { t, args, claim, failure } = await setup()
  const quotaBefore = await t.query(internal.routines.target, args)
  expect(quotaBefore.remaining).toBe(quotaBefore.target)
  expect(quotaBefore.target).toBeGreaterThan(0)
  const prior = { classification: 'business' as const, screenedAt: 123 }
  await t.run(async ctx => {
    if (saved) await ctx.db.patch(claim.leadId, prior)
    const listId = await ctx.db.insert('leadLists', { name: 'Another list', createdAt: 0 })
    await ctx.db.insert('leadMemberships', { leadId: claim.leadId, listId, available: true, leadCreatedAt: 0 })
  })
  expect(await t.mutation(internal.leadScreening.finish, { ...failure, failureReason: 'refused' })).toBe(false)
  const lead = (await t.run(ctx => ctx.db.get(claim.leadId)))!
  expect(lead).toMatchObject({ screeningStatus: 'error', screeningRefused: true, screeningFailures: 1 })
  if (saved) expect(lead).toMatchObject(prior)
  for (const field of ['screeningToken', 'screeningProfileId', 'screeningAutomationId', 'screeningListId', 'screeningUntil', 'senderId'])
    expect(lead).not.toHaveProperty(field)
  expect(leadAvailable(lead)).toBe(false)
  const memberships = await t.run(ctx => ctx.db.query('leadMemberships').collect())
  expect(memberships).toHaveLength(2)
  expect(memberships.every(row => !row.available)).toBe(true)
  expect(await t.mutation(internal.routines.reserve, args)).toBeNull()
  expect(await t.query(internal.routines.target, args)).toEqual(quotaBefore)
  expect(await t.mutation(internal.leadScreening.finish, { ...failure, category: 'male', confidence: 1 })).toBe(false)
  expect(await t.mutation(api.scraper.retryEnrichment, {})).toBe(0)
  await t.run(async ctx => {
    const listId = await ctx.db.insert('leadLists', { name: 'New scrape list', createdAt: 0 })
    await addMembership(ctx, lead._id, listId, lead.createdAt, leadAvailable(lead), lead.classification)
  })
  expect((await t.run(ctx => ctx.db.query('leadMemberships').collect())).every(row => !row.available)).toBe(true)
  expect(await t.mutation(internal.routines.reserve, args)).toBeNull()
})

test('a refusal cannot be submitted together with an approval category', async () => {
  const { t, failure, claim } = await setup()
  await expect(t.mutation(internal.leadScreening.finish, {
    ...failure, failureReason: 'refused', category: 'male', confidence: 1,
  })).rejects.toThrow('cannot include a category')
  const lead = (await t.run(ctx => ctx.db.get(claim.leadId)))!
  expect(lead).not.toHaveProperty('senderId')
  expect(lead).not.toHaveProperty('screeningRefused')
})

test('ordinary provider failures retain their retry backoff and can be retried manually', async () => {
  const { t, args, failure, claim } = await setup()
  const before = Date.now()
  expect(await t.mutation(internal.leadScreening.finish, failure)).toBe(false)
  const lead = (await t.run(ctx => ctx.db.get(claim.leadId)))!
  expect(lead).not.toHaveProperty('screeningRefused')
  expect(lead.screeningUntil).toBeGreaterThanOrEqual(before + 5 * 60_000)
  expect(leadAvailable(lead)).toBe(true)
  expect(await t.mutation(api.scraper.retryEnrichment, {})).toBe(1)
  expect((await t.mutation(internal.routines.reserve, args))?.leadId).toBe(claim.leadId)
})

test('indexed retries skip a refused backlog, include missing and false flags, and retry at most 100 failures', async () => {
  const t = createConvexTest()
  await t.run(async ctx => {
    for (let i = 0; i < 500; i++) await ctx.db.insert('leads', {
      username: `refused${i}`, screeningStatus: 'error', screeningRefused: true,
      screeningFailures: 1, dmSent: false, followed: false, createdAt: 0,
    })
    for (let i = 0; i < 125; i++) await ctx.db.insert('leads', {
      username: `retry${i}`, screeningStatus: 'error', screeningRefused: i < 60 ? undefined : false,
      screeningFailures: 3, screeningUntil: Date.now() + 60_000, dmSent: false, followed: false, createdAt: 0,
    })
  })
  expect(await t.mutation(api.scraper.retryEnrichment, {})).toBe(100)
  const first = await t.run(ctx => ctx.db.query('leads').collect())
  expect(first.filter(row => row.screeningStatus === 'pending')).toHaveLength(100)
  expect(first.filter(row => row.screeningRefused).every(row => row.screeningStatus === 'error')).toBe(true)
  expect(await t.mutation(api.scraper.retryEnrichment, {})).toBe(25)
  expect(await t.mutation(api.scraper.retryEnrichment, {})).toBe(0)
  const final = await t.run(ctx => ctx.db.query('leads').collect())
  const retryable = final.filter(row => !row.screeningRefused)
  expect(retryable).toHaveLength(125)
  expect(retryable.every(row => row.screeningStatus === 'pending' && row.screeningFailures === undefined && row.screeningUntil === undefined)).toBe(true)
  expect(final.filter(row => row.screeningRefused)).toHaveLength(500)
})
