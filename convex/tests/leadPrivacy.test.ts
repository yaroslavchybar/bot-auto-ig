import { expect, test } from 'vite-plus/test'
import { api, internal } from '../_generated/api'
import { defaultRoutine, dayKey } from '../routinePolicy'
import { createConvexTest, seedModel, seedProfile } from '../../tests/convex/helpers'

test.each([undefined, true, false])('a screening lease includes stored privacy without defaulting unknown leads (%s)', async isPrivate => {
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
    const leadId = await ctx.db.insert('leads', {
      username: 'alice', isPrivate, screeningStatus: 'pending', dmSent: false, followed: false, createdAt,
    })
    await ctx.db.insert('leadMemberships', { leadId, listId: leadListId, available: true, leadCreatedAt: createdAt })
  })
  const claim = (await t.mutation(internal.routines.reserve, { automationId: automation._id, profileId: profile._id }))!
  expect(claim).not.toBeNull()
  expect(claim.isPrivate).toBe(isPrivate)
})

test('scraping saves known privacy, keeps unknown leads unset, and refreshes existing values', async () => {
  const t = createConvexTest()
  const run = await t.run(async ctx => {
    const now = Date.now()
    const profileId = await ctx.db.insert('profiles', { name: 'scraper', inUse: false, instagramSessionId: 'browser-cookie', createdAt: now })
    const listId = await ctx.db.insert('leadLists', { name: 'leads', createdAt: now })
    await ctx.db.insert('leadListCounts', { listId, count: 0 })
    const sourceId = await ctx.db.insert('scrapeSources', {
      username: 'source', listId, profileId, enabled: true, running: true, runKind: 'likers',
      runId: 'privacy-scrape', leaseUntil: now + 60_000, nextCheckAt: now, postCount: 1, leadsAdded: 0, createdAt: now,
    })
    const postId = await ctx.db.insert('scrapePosts', {
      sourceId, mediaId: '1', code: 'post', takenAt: now, scheduled: true, monitoring: false, nextCheckAt: now,
    })
    await ctx.db.patch(sourceId, { currentPostId: postId })
    return { sourceId, runId: 'privacy-scrape' }
  })
  await t.mutation(internal.scraper.saveBatch, { ...run, likers: [
    { igId: '1000', username: 'public', isPrivate: false },
    { igId: '1001', username: 'private', isPrivate: true },
    { igId: '1002', username: 'unknown' },
  ] })
  const leads = await t.run(ctx => ctx.db.query('leads').collect())
  expect(leads.find(lead => lead.username === 'public')?.isPrivate).toBe(false)
  expect(leads.find(lead => lead.username === 'private')?.isPrivate).toBe(true)
  expect(leads.find(lead => lead.username === 'unknown')).not.toHaveProperty('isPrivate')
  await t.mutation(internal.scraper.saveBatch, { ...run, likers: [
    { igId: '1000', username: 'public', isPrivate: true },
    { igId: '1001', username: 'private' },
    { igId: '1002', username: 'unknown', isPrivate: false },
  ] })
  const updated = await t.run(ctx => ctx.db.query('leads').collect())
  expect(updated).toHaveLength(3)
  expect(updated.find(lead => lead.username === 'public')?.isPrivate).toBe(true)
  expect(updated.find(lead => lead.username === 'private')?.isPrivate).toBe(true)
  expect(updated.find(lead => lead.username === 'unknown')?.isPrivate).toBe(false)
  expect(await t.run(ctx => ctx.db.query('leadMemberships').collect())).toHaveLength(3)
})
