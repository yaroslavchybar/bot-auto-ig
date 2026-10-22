import { afterEach, expect, test, vi } from 'vite-plus/test'
import { api, internal } from '../_generated/api'
import { defaultRoutine, dayKey } from '../routinePolicy'
import { createConvexTest, seedModel, seedProfile } from '../../tests/convex/helpers'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

async function setup() {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-11T10:00:00Z'))
  const t = createConvexTest()
  const list = (await seedModel(t))!, profile = (await seedProfile(t))!
  await t.mutation(api.profiles.mutations.bulkAddToModel, { profileIds: [profile._id], modelId: list._id })
  const leadListId = await t.mutation(api.leads.createList, { name: 'Recipients' })
  const automation = (await t.mutation(api.automations.mutations.create, {
    name: 'Outreach', nodes: [], edges: [], modelIds: [list._id],
    routine: { ...defaultRoutine, initialDms: 3, maxDms: 10, outreachEnabled: true, leadListId, message: 'Hello' },
  }))!
  await t.mutation(api.automations.mutations.setActive, { id: automation._id, isActive: true })
  await t.mutation(api.profiles.mutations.setIgState, { profileId: profile._id, igLoggedIn: true })
  await t.run(async ctx => {
    await ctx.db.insert('accountProgress', { profileId: profile._id, paused: false, activeDays: 0,
      outreachQuotaDate: dayKey(), outreachUsedToday: 0, outreachAllowanceToday: 3,
      followedToday: 0, nextRunAt: 0, updatedAt: Date.now() });
    await ctx.db.patch(profile._id, { outreachReady: true })
    await ctx.db.insert('warmupStates', { profileId: profile._id, day: 8, date: dayKey(),
      runsToday: 1, todayMinutes: 30, minutesUsedToday: 0, })
    for (const username of ['alice', 'bob']) {
      const createdAt = Date.now()
      const leadId = await ctx.db.insert('leads', { username, isPrivate: true,
        screeningStatus: 'pending', dmSent: false, followed: false, createdAt })
      await ctx.db.insert('leadMemberships', { leadId, listId: leadListId, available: true, leadCreatedAt: createdAt })
    }
  })
  const args = { automationId: automation._id, profileId: profile._id }
  const claim = async () => {
    const reserved = (await t.mutation(internal.routines.reserve, args))!
    expect(reserved).not.toBeNull()
    expect(await t.mutation(internal.leadScreening.finish, { ...args, leadId: reserved.leadId,
      date: reserved.date, screeningToken: reserved.screeningToken, category: 'male', confidence: 1,
      model: 'liquid/d1-ultra', englishTextCheckPassed: true })).toBe(true)
    return reserved
  }
  return { t, args, claim }
}

test('a same-day public or private follow uses its screening slot exactly once', async () => {
  const { t, args, claim } = await setup()
  const lead = await claim(), input = { ...args, leadId: lead.leadId, date: dayKey() }
  await t.run(ctx => ctx.db.patch(lead.leadId, { isPrivate: false }))
  const before = await t.query(internal.routines.target, args)
  expect(await t.mutation(internal.routines.beginFollow, input)).toBe(true)
  expect(await t.mutation(internal.routines.beginFollow, input)).toBe(false)
  expect(await t.query(internal.routines.target, args)).toEqual(before)
})

test('later-day public or private follows atomically reserve the remaining quota before follow intent', async () => {
  const { t, args, claim } = await setup()
  const leads = [await claim(), await claim()]
  vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
  await t.run(async ctx => {
    const state = (await ctx.db.query('accountProgress').unique())!
    await ctx.db.patch(state._id, { outreachQuotaDate: dayKey(), outreachUsedToday: 0, outreachAllowanceToday: 1 })
  })
  const results = await Promise.all(leads.map(lead => t.mutation(internal.routines.beginFollow,
    { ...args, leadId: lead.leadId, date: dayKey() })))
  expect(results.filter(Boolean)).toHaveLength(1)
  expect(await t.query(internal.routines.target, args)).toMatchObject({ remaining: 0 })
  const saved = await t.run(ctx => Promise.all(leads.map(lead => ctx.db.get(lead.leadId))))
  expect(saved.filter(lead => lead?.followStartedAt !== undefined)).toHaveLength(1)
  const state = (await t.run(ctx => ctx.db.query('accountProgress').unique()))!
  expect(state).toMatchObject({ outreachQuotaDate: dayKey(), outreachUsedToday: 1 })
  const winner = leads[results.indexOf(true)]!
  expect(await t.mutation(internal.routines.beginFollow, { ...args, leadId: winner.leadId, date: dayKey() })).toBe(false)
  expect(await t.run(ctx => ctx.db.get(state._id))).toMatchObject({ outreachUsedToday: 1 })
})

test('old public-DM eligibility cannot bypass following and notification evidence', async () => {
  const { t, args, claim } = await setup()
  const lead = await claim()
  await t.run(ctx => ctx.db.patch(lead.leadId, { isPrivate: false, dmEligible: true, lastDmCheckDate: dayKey() }))
  vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
  const input = { ...args, leadId: lead.leadId, date: dayKey() }
  expect(await t.query(internal.routines.notifications, args)).toBeNull()
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([])
  expect(await t.mutation(internal.routines.beginSend, input)).toBe(false)
  await t.mutation(internal.routines.recordNotifications, { ...args, date: dayKey(), events: [{ username: lead.username, kind: 'follow' }] })
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([])
  await t.run(ctx => ctx.db.patch(lead.leadId, { followed: true, followDate: Date.now() - 86_400_000 }))
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([])
  expect(await t.mutation(internal.routines.beginSend, input)).toBe(false)
  await t.mutation(internal.routines.recordNotifications, { ...args, date: dayKey(), events: [{ username: lead.username, kind: 'follow' }] })
  expect(await t.query(internal.routines.dmTasks, args)).toHaveLength(1)
  const before = await t.query(internal.routines.target, args)
  expect(await t.mutation(internal.routines.beginSend, input)).toBe(true)
  expect(await t.mutation(internal.routines.beginSend, input)).toBe(false)
  expect(await t.query(internal.routines.target, args)).toEqual(before)
})

test('follow-back notifications stop enabling DMs when unfollow becomes due', async () => {
  const { t, args, claim } = await setup()
  const lead = await claim()
  await t.mutation(internal.routines.beginFollow, { ...args, leadId: lead.leadId, date: dayKey() })
  await t.mutation(internal.routines.recordFollow, { profileId: args.profileId, leadId: lead.leadId, followed: true })
  expect(await t.query(internal.routines.notifications, args)).toBeNull()
  vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
  expect(await t.query(internal.routines.notifications, args)).toMatchObject({ date: dayKey() })
  vi.stubGlobal('process', { env: { INTERNAL_API_KEY: 'test-outreach-token' } })
  const response = await t.fetch('/api/routines/record-notifications', {
    method: 'POST', headers: { authorization: 'Bearer test-outreach-token', 'content-type': 'application/json' },
    body: JSON.stringify({ ...args, date: dayKey(), events: [{ username: lead.username.toUpperCase(), kind: 'follow' }] }),
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true, scanLikers: false })
  expect(await t.query(internal.routines.notifications, args)).toBeNull()
  expect(await t.query(internal.routines.dmTasks, args)).toHaveLength(1)
  const saved = (await t.run(ctx => ctx.db.get(lead.leadId)))!
  vi.setSystemTime(saved.unfollowAt!)
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([])
  expect(await t.mutation(internal.routines.beginSend, { ...args, leadId: lead.leadId, date: dayKey() })).toBe(false)
  expect(await t.query(internal.routines.followTasks, args)).toMatchObject([{ leadId: lead.leadId }])
})

test.each(['like', 'comment'] as const)('%s notifications permit one DM to a followed lead without a follow-back', async kind => {
  const { t, args, claim } = await setup()
  const lead = await claim()
  const event = { username: lead.username, kind }
  expect(await t.mutation(internal.routines.recordNotifications, { ...args, date: dayKey(), events: [event] })).toBe(false)
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([])
  await t.mutation(internal.routines.recordFollow, { profileId: args.profileId, leadId: lead.leadId, followed: true })
  expect(await t.mutation(internal.routines.recordNotifications, { ...args, date: dayKey(), events: [event] })).toBe(false)
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([])
  vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
  expect(await t.mutation(internal.routines.recordNotifications, { ...args, date: dayKey(), events: [event, event] })).toBe(kind === 'like')
  expect(await t.run(ctx => ctx.db.get(lead.leadId))).toMatchObject({ postEngagement: { kind, at: Date.now() } })
  expect((await t.run(ctx => ctx.db.get(lead.leadId)))?.followBackAt).toBeUndefined()
  expect(await t.query(internal.routines.dmTasks, args)).toMatchObject([{ leadId: lead.leadId, engagement: kind }])
  const input = { ...args, leadId: lead.leadId, date: dayKey() }
  const before = await t.query(internal.routines.target, args)
  expect(await t.mutation(internal.routines.beginSend, input)).toBe(true)
  expect(await t.mutation(internal.routines.beginSend, input)).toBe(false)
  await t.mutation(internal.routines.finishSend, { profileId: args.profileId, leadId: lead.leadId, date: dayKey(), sent: true })
  expect(await t.mutation(internal.routines.recordNotifications, { ...args, date: dayKey(), events: [event] })).toBe(false)
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([])
  expect(await t.query(internal.routines.target, args)).toEqual(before)
})

test.each(['expired', 'other sender', 'unfollowed', 'uncertain', 'blocked', 'sent'] as const)(
  'post engagement cannot authorize a DM when the lead is %s', async reason => {
    const { t, args, claim } = await setup()
    const lead = await claim()
    await t.mutation(internal.routines.recordFollow, { profileId: args.profileId, leadId: lead.leadId, followed: true })
    vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
    const other = (await seedProfile(t, { name: 'Other sender' }))!
    await t.run(ctx => ctx.db.patch(lead.leadId, {
      ...(reason === 'expired' ? { unfollowAt: Date.now() } : {}),
      ...(reason === 'other sender' ? { senderId: other._id } : {}),
      ...(reason === 'unfollowed' ? { followed: false } : {}),
      ...(reason === 'uncertain' ? { dmStartedAt: Date.now() } : {}),
      ...(reason === 'blocked' ? { dmBlocked: true } : {}),
      ...(reason === 'sent' ? { dmSent: true } : {}),
    }))
    expect(await t.mutation(internal.routines.recordNotifications, { ...args, date: dayKey(), events: [{ username: lead.username, kind: 'like' }] })).toBe(false)
    expect(await t.query(internal.routines.dmTasks, args)).toEqual([])
    expect(await t.mutation(internal.routines.beginSend, { ...args, leadId: lead.leadId, date: dayKey() })).toBe(false)
  },
)

test('unrelated likes and empty scans do not trigger liker scraping; matching likes need no notification cache', async () => {
  const { t, args, claim } = await setup()
  const lead = await claim()
  await t.mutation(internal.routines.recordFollow, { profileId: args.profileId, leadId: lead.leadId, followed: true })
  vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
  const record = (events: { username: string; kind: 'like' }[]) => t.mutation(internal.routines.recordNotifications, { ...args, date: dayKey(), events })
  expect(await record([])).toBe(false)
  expect(await record([{ username: 'stranger', kind: 'like' }])).toBe(false)
  // Eligibility comes from current follow/DM state, even when the same row is shown again.
  for (let i = 0; i < 2; i++) expect(await record([{ username: lead.username, kind: 'like' }])).toBe(true)
})

test.each(['follow', 'like', 'comment'] as const)('%s notifications cannot message an already-sent lead, even from a stale queue', async kind => {
  const { t, args, claim } = await setup()
  const lead = await claim()
  await t.mutation(internal.routines.recordFollow, { profileId: args.profileId, leadId: lead.leadId, followed: true })
  vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
  const notification = { ...args, date: dayKey(), events: [{ username: lead.username, kind }] }
  await t.mutation(internal.routines.recordNotifications, notification)
  expect(await t.query(internal.routines.dmTasks, args)).toHaveLength(1)

  // Another worker or a manual status update can mark the lead sent after tasks were loaded.
  await t.run(ctx => ctx.db.patch(lead.leadId, { dmSent: true }))
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([])
  expect(await t.mutation(internal.routines.beginSend, { ...args, leadId: lead.leadId, date: dayKey() })).toBe(false)
  expect(await t.mutation(internal.routines.recordNotifications, notification)).toBe(false)
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([])
  expect((await t.run(ctx => ctx.db.get(lead.leadId)))?.dmStartedAt).toBeUndefined()
})

test.each(['DMs disabled', 'sent', 'blocked', 'uncertain'] as const)('follow-back analytics count once when %s without authorizing DMs', async condition => {
  const { t, args, claim } = await setup()
  const lead = await claim()
  await t.mutation(api.analytics.initialize, {})
  const follow = { profileId: args.profileId, leadId: lead.leadId, followed: true }
  await t.mutation(internal.routines.recordFollow, follow)
  await t.mutation(internal.routines.recordFollow, follow)
  await t.run(async ctx => {
    if (condition === 'DMs disabled') {
      const automation = (await ctx.db.get(args.automationId))!
      await ctx.db.patch(automation._id, { routine: { ...automation.routine!, notificationDmsEnabled: false } })
    } else await ctx.db.patch(lead.leadId,
      condition === 'sent' ? { dmSent: true } : condition === 'blocked' ? { dmBlocked: true } : { dmStartedAt: Date.now() })
  })
  vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
  expect(await t.query(internal.routines.notifications, args)).toMatchObject({ date: dayKey() })
  const notification = { ...args, date: dayKey(), events: [{ username: lead.username, kind: 'follow' as const }] }
  await t.mutation(internal.routines.recordNotifications, notification)
  const firstAt = (await t.run(ctx => ctx.db.get(lead.leadId)))!.followBackAt
  vi.setSystemTime(Date.now() + 60_000)
  await t.mutation(internal.routines.recordNotifications, { ...notification, events: [...notification.events, ...notification.events] })
  expect((await t.run(ctx => ctx.db.get(lead.leadId)))?.followBackAt).toBe(firstAt)
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([])
  const result = await t.query(api.analytics.overview, { date: dayKey(), period: '7days' })
  expect(result.outreach.totals).toEqual({ followed: 1, followedBack: 1, pending: 0, rate: 100 })
  expect((await t.query(api.analytics.overview, { date: dayKey(), period: 'today' })).outreach.totals.followed).toBe(0)
  if (condition === 'DMs disabled') {
    await t.run(async ctx => {
      const automation = (await ctx.db.get(args.automationId))!
      await ctx.db.patch(automation._id, { routine: { ...automation.routine!, notificationDmsEnabled: true } })
    })
    expect(await t.query(internal.routines.dmTasks, args)).toHaveLength(1)
  }
})

test('conversion history survives unfollow and a late follow-back does not consume another lead pending count', async () => {
  const { t, args, claim } = await setup()
  await t.mutation(api.analytics.initialize, {})
  const first = await claim(), second = await claim()
  for (const lead of [first, second]) await t.mutation(internal.routines.recordFollow, { profileId: args.profileId, leadId: lead.leadId, followed: true })
  await t.run(ctx => ctx.db.patch(first.leadId, { unfollowAt: Date.now() }))
  const unfollow = { profileId: args.profileId, leadId: first.leadId, followed: false }
  await t.mutation(internal.routines.recordFollow, unfollow)
  await t.mutation(internal.routines.recordFollow, unfollow)
  vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
  await t.mutation(internal.routines.recordNotifications, { ...args, date: dayKey(), events: [{ username: first.username, kind: 'follow' }] })
  expect((await t.query(api.analytics.overview, { date: dayKey(), period: '7days' })).outreach.totals)
    .toEqual({ followed: 2, followedBack: 1, pending: 1, rate: 50 })
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([])
})

test('a notification older than this lead follow cannot inflate conversions or enable a DM', async () => {
  const { t, args, claim } = await setup()
  const lead = await claim()
  await t.mutation(internal.routines.recordFollow, { profileId: args.profileId, leadId: lead.leadId, followed: true })
  const followDate = (await t.run(ctx => ctx.db.get(lead.leadId)))!.followDate!
  vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
  const notification = { ...args, date: dayKey(), events: [{ username: lead.username, kind: 'follow' as const, timeUpperBound: followDate - 1 }] }
  await t.mutation(internal.routines.recordNotifications, notification)
  expect((await t.run(ctx => ctx.db.get(lead.leadId)))?.followBackAt).toBeUndefined()
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([])
  expect(await t.run(ctx => ctx.db.query('outreachDays').unique())).toMatchObject({ followedBack: 0, pending: 1 })
  await t.mutation(internal.routines.recordNotifications, { ...notification, events: [{ ...notification.events[0], timeUpperBound: Date.now() }] })
  expect(await t.run(ctx => ctx.db.query('outreachDays').unique())).toMatchObject({ followedBack: 1, pending: 0 })
})

test('follow-back history stays with the original automation after the profile changes automations', async () => {
  const { t, args, claim } = await setup()
  const lead = await claim()
  await t.mutation(internal.routines.recordFollow, { profileId: args.profileId, leadId: lead.leadId, followed: true })
  const automationId = await t.run(async ctx => {
    const previous = (await ctx.db.get(args.automationId))!
    await ctx.db.patch(previous._id, { isActive: false })
    return ctx.db.insert('automations', { name: 'Replacement', nodes: [], edges: [],
      modelIds: previous.modelIds, routine: previous.routine, isActive: true, createdAt: Date.now(), updatedAt: Date.now() })
  })
  vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
  const current = { ...args, automationId }
  expect(await t.query(internal.routines.notifications, current)).toMatchObject({ date: dayKey() })
  await t.mutation(internal.routines.recordNotifications, { ...current, date: dayKey(), events: [{ username: lead.username, kind: 'follow' }] })
  const history = await t.run(ctx => ctx.db.query('outreachDays').unique())
  expect(history).toMatchObject({ automationId: args.automationId, followed: 1, followedBack: 1, pending: 0 })
  expect(await t.query(internal.routines.dmTasks, current)).toEqual([])
})
