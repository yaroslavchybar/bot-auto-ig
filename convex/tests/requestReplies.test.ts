import { afterEach, expect, test, vi } from 'vite-plus/test'
import { api, internal } from '../_generated/api'
import { defaultRoutine, dayKey } from '../routinePolicy'
import { createConvexTest, seedModel, seedProfile } from '../../tests/convex/helpers'

afterEach(() => vi.useRealTimers())
async function setup() {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
  const t = createConvexTest(), model = (await seedModel(t))!, profile = (await seedProfile(t))!
  await t.mutation(api.profiles.mutations.bulkAddToModel, { profileIds: [profile._id], modelId: model._id })
  const leadListId = await t.mutation(api.leads.createList, { name: 'Outreach' })
  const automation = (await t.mutation(api.automations.mutations.create, { name: 'Daily', modelIds: [model._id],
    routine: { ...defaultRoutine, outreachEnabled: true, outreach: { leadListId, allProfiles: true, profileIds: [], message: 'Hi {{username}}' } } }))!
  await t.mutation(api.automations.mutations.setActive, { id: automation._id, isActive: true })
  await t.mutation(api.profiles.mutations.setIgState, { profileId: profile._id, igLoggedIn: true })
  await t.run(async ctx => {
    await ctx.db.patch(profile._id, { outreachReady: true })
    await ctx.db.insert('warmupStates', { profileId: profile._id, day: 8, date: dayKey(), runsToday: 1, todayMinutes: 30, minutesUsedToday: 0 })
  })
  const context = { automationId: automation._id, profileId: profile._id }
  const args = { ...context, threadId: '123', username: 'stranger' }
  return { t, args, context, automation }
}

test('a new request needs no lead or follow-back, resumes acceptance, and sends at most once', async () => {
  const { t, args, context } = await setup()
  expect(await t.mutation(internal.requestReplies.prepare, args)).toBe(true)
  expect(await t.mutation(internal.requestReplies.prepare, args)).toBe(true)
  expect(await t.query(internal.requestReplies.plan, context)).toMatchObject({ message: 'Hi {{username}}', uncertain: false,
    pending: [{ threadId: '123', username: 'stranger' }] })
  const claims = await Promise.all([t.mutation(internal.requestReplies.begin, args), t.mutation(internal.requestReplies.begin, args)])
  expect(claims.filter(Boolean)).toHaveLength(1)
  expect(await t.query(internal.requestReplies.plan, context)).toMatchObject({ uncertain: true, pending: [] })
  for (let i = 0; i < 2; i++) await t.mutation(internal.requestReplies.finish, { ...args, sent: true, blocked: false })
  expect(await t.mutation(internal.requestReplies.prepare, args)).toBe(false)
  expect(await t.mutation(internal.requestReplies.begin, args)).toBe(false)
  expect(await t.run(ctx => ctx.db.query('accountProgress').unique())).toMatchObject({ sentToday: 1 })
  expect(await t.run(ctx => ctx.db.query('leads').collect())).toEqual([])
})

test.each(['paused', 'DMs off', 'warm-up'] as const)('a fresh request claim rechecks %s', async reason => {
  const { t, args, context, automation } = await setup()
  await t.mutation(internal.requestReplies.prepare, args)
  await t.run(async ctx => {
    if (reason === 'paused') await ctx.db.patch(args.profileId, { paused: true })
    if (reason === 'DMs off') await ctx.db.patch(args.automationId, { routine: { ...automation.routine!, notificationDmsEnabled: false } })
    if (reason === 'warm-up') { const state = (await ctx.db.query('warmupStates').unique())!; await ctx.db.patch(state._id, { day: 7 }) }
  })
  expect(await t.query(internal.requestReplies.plan, context)).toBeNull()
  expect(await t.mutation(internal.requestReplies.begin, args)).toBe(false)
  expect(await t.run(ctx => ctx.db.query('requestReplies').unique())).toMatchObject({ status: 'pending' })
})

test('an uncertain reply remains permanently claimed and stops the profile for review', async () => {
  const { t, args } = await setup()
  await t.mutation(internal.requestReplies.prepare, args)
  await t.mutation(internal.requestReplies.begin, args)
  await t.mutation(internal.requestReplies.finish, { ...args, sent: false, blocked: false })
  expect(await t.run(ctx => ctx.db.query('accountProgress').unique())).toMatchObject({ issue: expect.stringContaining('needs review') })
  expect(await t.mutation(internal.requestReplies.begin, args)).toBe(false)
  expect(await t.run(ctx => ctx.db.query('requestReplies').unique())).toMatchObject({ status: 'sending' })
})

test('another recipient cannot reuse a request claim; a blocked reply never retries', async () => {
  const { t, args } = await setup()
  await t.mutation(internal.requestReplies.prepare, args)
  expect(await t.mutation(internal.requestReplies.begin, { ...args, username: 'someone_else' })).toBe(false)
  await t.mutation(internal.requestReplies.begin, args)
  await t.mutation(internal.requestReplies.finish, { ...args, sent: false, blocked: true })
  expect(await t.mutation(internal.requestReplies.prepare, args)).toBe(false)
  expect(await t.run(ctx => ctx.db.query('requestReplies').unique())).toMatchObject({ status: 'blocked' })
})

test('request replies share the outbound lead lock and mark a matching lead messaged', async () => {
  const { t, args } = await setup()
  const leadId = await t.run(ctx => ctx.db.insert('leads', { username: args.username, senderId: args.profileId,
    dmSent: false, followed: false, createdAt: Date.now() }))
  await t.mutation(internal.requestReplies.prepare, args)
  await t.mutation(internal.requestReplies.begin, args)
  expect(await t.run(ctx => ctx.db.get(leadId))).toMatchObject({ dmStartedAt: expect.any(Number), dmEligible: false })
  await t.mutation(internal.requestReplies.finish, { ...args, sent: true, blocked: false })
  expect(await t.run(ctx => ctx.db.get(leadId))).toMatchObject({ dmSent: true })
})

test('a pending request closes if another path already sent the outreach', async () => {
  const { t, args, context } = await setup()
  await t.mutation(internal.requestReplies.prepare, args)
  await t.run(ctx => ctx.db.insert('leads', { username: args.username, senderId: args.profileId,
    dmSent: true, followed: true, createdAt: Date.now() }))
  expect(await t.mutation(internal.requestReplies.begin, args)).toBe(false)
  expect(await t.query(internal.requestReplies.plan, context)).toMatchObject({ pending: [] })
})

test('a request reply prevents outreach even when the lead is imported later', async () => {
  const { t, args, context, automation } = await setup()
  await t.mutation(internal.requestReplies.prepare, args)
  await t.mutation(internal.requestReplies.begin, args)
  await t.mutation(internal.requestReplies.finish, { ...args, sent: true, blocked: false })
  const leadId = await t.run(ctx => ctx.db.insert('leads', { username: args.username, senderId: args.profileId,
    dmSent: false, dmEligible: true, classification: 'male', followed: true, followDate: Date.now() - 86_400_000,
    followBackAt: Date.now(), outreachAutomationId: args.automationId, outreachListId: automation.routine!.outreach!.leadListId,
    createdAt: Date.now() }))
  expect(await t.query(internal.routines.dmTasks, context)).toEqual([])
  expect(await t.mutation(internal.routines.beginSend, { ...context, leadId, date: dayKey() })).toBe(false)
})

test('manual DM detection marks only this sender and closes pending replies without adding today sends', async () => {
  const { t, args, context } = await setup()
  const other = (await seedProfile(t, { name: 'Other sender' }))!
  const ids = await t.run(async ctx => {
    const lead = { username: args.username, dmSent: false, followed: true, dmEligible: true, createdAt: Date.now() }
    const ownId = await ctx.db.insert('leads', { ...lead, senderId: args.profileId })
    const otherId = await ctx.db.insert('leads', { ...lead, senderId: other._id })
    await ctx.db.insert('accountProgress', { profileId: args.profileId, activeDays: 0, nextRunAt: 0,
      updatedAt: Date.now(), dmCountDate: dayKey(), sentToday: 2, outreachAllowanceToday: 0, outreachUsedToday: 0 })
    return { ownId, otherId }
  })
  await t.mutation(internal.requestReplies.prepare, args)
  const before = await t.run(ctx => ctx.db.query('analyticsDays').collect())
  for (let retry = 0; retry < 2; retry++) expect(await t.mutation(internal.routines.recordExistingDm, args)).toBe(true)
  expect(await t.run(ctx => ctx.db.get(ids.ownId))).toMatchObject({ dmSent: true, dmEligible: false })
  expect(await t.run(ctx => ctx.db.get(ids.otherId))).toMatchObject({ dmSent: false, dmEligible: true })
  expect(await t.run(ctx => ctx.db.query('requestReplies').unique())).toMatchObject({ status: 'sent' })
  expect(await t.query(internal.requestReplies.plan, context)).toMatchObject({ pending: [] })
  expect(await t.mutation(internal.requestReplies.begin, args)).toBe(false)
  expect(await t.run(ctx => ctx.db.query('accountProgress').unique())).toMatchObject({ sentToday: 2 })
  expect(await t.run(ctx => ctx.db.query('analyticsDays').collect())).toEqual(before)
})

test('a manual DM detected in a profile chat does not need a thread URL', async () => {
  const { t, args, context } = await setup()
  const leadId = await t.run(ctx => ctx.db.insert('leads', { username: args.username, senderId: args.profileId,
    dmSent: false, followed: true, dmEligible: true, createdAt: Date.now() }))
  expect(await t.mutation(internal.routines.recordExistingDm, { ...context, username: args.username })).toBe(true)
  expect(await t.run(ctx => ctx.db.get(leadId))).toMatchObject({ dmSent: true, dmEligible: false })
  expect(await t.run(ctx => ctx.db.query('requestReplies').collect())).toEqual([])
})

test('a manual DM from an unknown sender prevents future outreach when a lead is added later', async () => {
  const { t, args, context, automation } = await setup()
  expect(await t.mutation(internal.routines.recordExistingDm, args)).toBe(true)
  const leadId = await t.run(ctx => ctx.db.insert('leads', { username: args.username, senderId: args.profileId,
    dmSent: false, followed: true, dmEligible: true, classification: 'male', followDate: Date.now() - 86_400_000,
    followBackAt: Date.now(), outreachAutomationId: args.automationId, outreachListId: automation.routine!.outreach!.leadListId,
    createdAt: Date.now() }))
  expect(await t.query(internal.routines.dmTasks, context)).toEqual([])
  expect(await t.mutation(internal.routines.beginSend, { ...context, leadId, date: dayKey() })).toBe(false)
  expect(await t.mutation(internal.requestReplies.prepare, args)).toBe(false)
})

test('manual DM reconciliation cannot reuse a thread for another recipient or write after access changes', async () => {
  const { t, args } = await setup()
  await t.mutation(internal.requestReplies.prepare, args)
  await expect(t.mutation(internal.routines.recordExistingDm, { ...args, username: 'someone_else' })).rejects.toThrow('recipient changed')
  await t.run(ctx => ctx.db.patch(args.profileId, { paused: true }))
  expect(await t.mutation(internal.routines.recordExistingDm, args)).toBe(false)
  expect(await t.run(ctx => ctx.db.query('requestReplies').unique())).toMatchObject({ status: 'pending' })
})
