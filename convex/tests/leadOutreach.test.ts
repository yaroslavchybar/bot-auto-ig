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

test('live public checks allow one DM without a follow or cleanup deadline', async () => {
  const { t, args, claim } = await setup()
  const lead = await claim(), input = { ...args, leadId: lead.leadId, date: dayKey() }
  expect(await t.mutation(internal.routines.recordDmCheck, { ...input, isPrivate: false, canMessage: true })).toBe(true)
  expect(await t.mutation(internal.routines.beginFollow, input)).toBe(false)
  expect(await t.mutation(internal.routines.beginSend, input)).toBe(true)
  expect(await t.mutation(internal.routines.beginSend, input)).toBe(false)
  const finish = { profileId: args.profileId, leadId: lead.leadId, date: dayKey(), sent: true }
  await t.mutation(internal.routines.finishSend, finish)
  await t.mutation(internal.routines.finishSend, finish)
  const saved = (await t.run(ctx => ctx.db.get(lead.leadId)))!
  expect(saved).toMatchObject({ isPrivate: false, followed: false, dmSent: true })
  expect(saved.followDate).toBeUndefined()
  expect(saved.unfollowAt).toBeUndefined()
  expect(await t.query(internal.routines.followTasks, args)).toEqual([])
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([])
  const state = (await t.run(ctx => ctx.db.query('accountProgress').unique()))!
  expect(state).toMatchObject({ outreachUsedToday: 1, followedToday: 0, sentToday: 1 })
  expect(state.outreachIncrease).toBeGreaterThanOrEqual(1)
  expect(state.outreachIncrease).toBeLessThanOrEqual(4)
})

test('a same-day private follow uses its screening slot exactly once', async () => {
  const { t, args, claim } = await setup()
  const lead = await claim(), input = { ...args, leadId: lead.leadId, date: dayKey() }
  const before = await t.query(internal.routines.target, args)
  expect(await t.mutation(internal.routines.beginFollow, input)).toBe(true)
  expect(await t.mutation(internal.routines.beginFollow, input)).toBe(false)
  expect(await t.query(internal.routines.target, args)).toEqual(before)
})

test('later-day private follows atomically reserve the remaining quota before follow intent', async () => {
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

test.each([true, false, undefined])('unfollowed private leads stay out of revisits; public/unknown leads retain history guards (%s)', async isPrivate => {
  const { t, args, claim } = await setup()
  const lead = await claim()
  vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
  for (const history of [{}, { followDate: Date.now() }, { followStartedAt: Date.now() }]) {
    await t.run(ctx => ctx.db.patch(lead.leadId, { isPrivate, followDate: undefined, followStartedAt: undefined, ...history }))
    expect(await t.query(internal.routines.dmTasks, args)).toHaveLength(isPrivate !== true && Object.keys(history).length === 0 ? 1 : 0)
  }
})

test('public DM revisits stay quota-free when the daily outreach limit is exhausted', async () => {
  const { t, args, claim } = await setup()
  const lead = await claim()
  await t.mutation(internal.routines.recordDmCheck, { ...args, leadId: lead.leadId, date: dayKey(), isPrivate: false, canMessage: true })
  vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
  await t.run(async ctx => {
    const state = (await ctx.db.query('accountProgress').unique())!
    await ctx.db.patch(state._id, { outreachQuotaDate: dayKey(), outreachUsedToday: 3, outreachAllowanceToday: 3 })
  })
  const before = await t.query(internal.routines.target, args)
  expect(before.remaining).toBe(0)
  expect(await t.query(internal.routines.dmTasks, args)).toHaveLength(1)
  const input = { ...args, leadId: lead.leadId, date: dayKey() }
  expect(await t.mutation(internal.routines.recordDmCheck, { ...input, isPrivate: false, canMessage: true })).toBe(true)
  expect(await t.mutation(internal.routines.beginSend, input)).toBe(true)
  expect(await t.query(internal.routines.target, args)).toEqual(before)
})

test.each([true, false, null, undefined, 0, 'false', {}, []])('DM-check HTTP privacy accepts only booleans (%j)', async isPrivate => {
  const { t, args, claim } = await setup()
  const lead = await claim()
  vi.stubGlobal('process', { env: { INTERNAL_API_KEY: 'test-outreach-token' } })
  const response = await t.fetch('/api/routines/record-dm-check', {
    method: 'POST', headers: { authorization: 'Bearer test-outreach-token', 'content-type': 'application/json' },
    body: JSON.stringify({ ...args, leadId: lead.leadId, date: dayKey(), canMessage: false, isPrivate }),
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toBe(false)
  expect(await t.run(ctx => ctx.db.get(lead.leadId))).toMatchObject({ isPrivate: typeof isPrivate === 'boolean' ? isPrivate : true })
})

test('private requests wait until tomorrow and expire into unfollow cleanup', async () => {
  const { t, args, claim } = await setup()
  const lead = await claim()
  const input = () => ({ ...args, leadId: lead.leadId, date: dayKey() })
  expect(await t.mutation(internal.routines.recordDmCheck, { ...input(), isPrivate: true, canMessage: true })).toBe(false)
  expect(await t.mutation(internal.routines.beginSend, input())).toBe(false)
  expect(await t.mutation(internal.routines.beginFollow, input())).toBe(true)
  await t.mutation(internal.routines.recordFollow, { profileId: args.profileId, leadId: lead.leadId, followed: true })
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([])
  const saved = (await t.run(ctx => ctx.db.get(lead.leadId)))!
  for (let day = 1; Date.now() + 86_400_000 < saved.unfollowAt!; day++) {
    vi.setSystemTime(new Date(`2026-10-${String(11 + day).padStart(2, '0')}T10:00:00Z`))
    expect(await t.query(internal.routines.dmTasks, args)).toHaveLength(1)
    expect(await t.mutation(internal.routines.recordDmCheck, { ...input(), isPrivate: true, canMessage: false })).toBe(false)
    expect(await t.query(internal.routines.dmTasks, args)).toEqual([])
    expect(await t.mutation(internal.routines.beginSend, input())).toBe(false)
  }
  vi.setSystemTime(saved.unfollowAt!)
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([])
  expect(await t.query(internal.routines.followTasks, args)).toMatchObject([{ leadId: lead.leadId }])
  expect(await t.mutation(internal.routines.recordDmCheck, { ...input(), isPrivate: false, canMessage: true })).toBe(false)
  await t.mutation(internal.routines.recordFollow, { profileId: args.profileId, leadId: lead.leadId, followed: false })
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([])
})

test('approval permits one DM and public DMs share the private-follow daily ramp', async () => {
  const { t, args, claim } = await setup()
  const first = await claim()
  const firstInput = { ...args, leadId: first.leadId, date: dayKey() }
  await t.mutation(internal.routines.recordDmCheck, { ...firstInput, isPrivate: true, canMessage: false })
  await t.mutation(internal.routines.beginFollow, firstInput)
  await t.mutation(internal.routines.recordFollow, { profileId: args.profileId, leadId: first.leadId, followed: true })
  const before = (await t.run(ctx => ctx.db.query('accountProgress').unique()))!
  const second = await claim()
  const secondInput = { ...args, leadId: second.leadId, date: dayKey() }
  await t.mutation(internal.routines.recordDmCheck, { ...secondInput, isPrivate: false, canMessage: true })
  await t.mutation(internal.routines.beginSend, secondInput)
  await t.mutation(internal.routines.finishSend, { profileId: args.profileId, leadId: second.leadId, date: dayKey(), sent: true })
  expect(await t.run(ctx => ctx.db.query('accountProgress').unique())).toMatchObject({
    outreachIncrease: before.outreachIncrease, followedToday: 1, sentToday: 1,
  })
  vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
  expect(await t.query(internal.routines.dmTasks, args)).toHaveLength(1)
  const approved = { ...firstInput, date: dayKey() }
  expect(await t.mutation(internal.routines.recordDmCheck, { ...approved, isPrivate: false, canMessage: true })).toBe(true)
  expect(await t.mutation(internal.routines.beginSend, approved)).toBe(true)
  expect(await t.mutation(internal.routines.beginSend, approved)).toBe(false)
})

test.each(['blocked', 'uncertain'] as const)('public pre-send interruptions retry daily but %s attempts never retry', async result => {
  const { t, args, claim } = await setup()
  const lead = await claim(), input = { ...args, leadId: lead.leadId, date: dayKey() }
  await t.mutation(internal.routines.recordDmCheck, { ...input, isPrivate: false, canMessage: true })
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([])
  vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
  expect(await t.query(internal.routines.dmTasks, args)).toHaveLength(1)
  const next = { ...input, date: dayKey() }
  expect(await t.mutation(internal.routines.recordDmCheck, { ...next, isPrivate: false, canMessage: true })).toBe(true)
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([])
  await t.mutation(internal.routines.beginSend, next)
  await t.mutation(internal.routines.finishSend, { profileId: args.profileId, leadId: lead.leadId, date: dayKey(),
    sent: false, blocked: result === 'blocked' })
  vi.setSystemTime(new Date('2026-10-13T10:00:00Z'))
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([])
  expect(await t.mutation(internal.routines.beginFollow, { ...input, date: dayKey() })).toBe(false)
})
