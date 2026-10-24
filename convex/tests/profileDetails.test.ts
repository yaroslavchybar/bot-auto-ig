import { expect, test } from 'vite-plus/test'
import { api } from '../_generated/api'
import { defaultRoutine, dayKey } from '../routinePolicy'
import { createConvexTest, seedModel, seedProfile } from '../../tests/convex/helpers'

test('profile details expose the same outreach state with setup and assignment information', async () => {
  const t = createConvexTest()
  const model = (await seedModel(t, 'Example model'))!
  const profile = (await seedProfile(t))!
  const { automationId } = await t.run(async (ctx) => {
    await ctx.db.patch(profile._id, {
      modelId: model._id,
      igLoggedIn: true,
      outreachReady: true,
      cookiesJson: 'private-cookies',
      instagramSessionId: 'private-session',
    })
    const listId = await ctx.db.insert('leadLists', { name: 'Recipients', createdAt: 1 })
    const automationId = await ctx.db.insert('automations', {
      name: 'Example automation',
      createdAt: 1,
      updatedAt: 1,
      isActive: true,
      modelIds: [model._id],
      routine: {
        ...defaultRoutine,
        initialDms: 5,
        maxDms: 10,
        outreachEnabled: true,
        outreach: { leadListId: listId, profileIds: [], allProfiles: true, message: 'Hi' },
      },
    })
    await ctx.db.insert('accountProgress', {
      profileId: profile._id,

      activeDays: 22,
      outreachUsedToday: 2,
      outreachAllowanceToday: 10,
      outreachQuotaDate: dayKey(),
      followedToday: 1,
      sentToday: 1,
      dmCountDate: dayKey(),
      issue: 'Delivery needs review',
      nextRunAt: 123,
      updatedAt: 1,
    })
    await ctx.db.insert('warmupStates', {
      profileId: profile._id,
      day: 8,
      date: dayKey(),
      runsToday: 1,
      todayMinutes: 10,
      minutesUsedToday: 10,
    })
    await ctx.db.insert('modelSetupStates', {
      profileId: profile._id,
      modelId: model._id,
      startedAt: 1,
      postSourceIds: ['one', 'two', 'three'],
      postDates: ['a', 'b', 'c'],
      postTarget: 3,
      usernameDone: true,
      fullNameDone: true,
      avatarDone: true,
      pending: { kind: 'post', date: dayKey() },
      error: 'Check this post',
    })
    return { automationId }
  })
  const details = await t.query(api.routines.profileDetails, { profileId: profile._id })
  const [summary] = await t.query(api.routines.accounts, { automationId })
  expect(details).toMatchObject({
    ...summary,
    dailyBudget: { date: dayKey(), total: 10, remaining: 0, running: false },
    model: { name: 'Example model' },
    automation: { name: 'Example automation', enabled: true },
    setup: { postsDone: 3, postTarget: 3, error: 'Check this post', pending: { kind: 'post' } },
  })
  expect(JSON.stringify(details)).not.toContain('private-')
  await t.mutation(api.routines.setAccount, { profileId: profile._id, clearIssue: true })
  expect(
    (await t.query(api.routines.profileDetails, { profileId: profile._id }))?.issue,
  ).toBeUndefined()
  await t.mutation(api.profiles.mutations.setPaused, { profileId: profile._id, paused: true })
  expect((await t.query(api.routines.profileDetails, { profileId: profile._id }))?.paused).toBe(
    true,
  )
})

test('unassigned profiles and profiles without progress can still be inspected and paused', async () => {
  const t = createConvexTest()
  const profile = (await seedProfile(t))!
  expect(await t.query(api.routines.profileDetails, { profileId: profile._id })).toMatchObject({
    automation: null,
    model: null,
    setup: null,
    activeDays: 0,
    allowance: 0,
    stage: 'Not logged in',
    dailyBudget: null,
  })
  await t.mutation(api.profiles.mutations.setPaused, { profileId: profile._id, paused: true })
  expect((await t.query(api.routines.profileDetails, { profileId: profile._id }))?.paused).toBe(
    true,
  )
  await t.run((ctx) => ctx.db.delete(profile._id))
  expect(await t.query(api.routines.profileDetails, { profileId: profile._id })).toBeNull()
})

test.each([
  { total: 30, used: undefined, remaining: 30, running: false },
  { total: 30, used: 17.5, remaining: 12.5, running: true },
  { total: 30, used: 40, remaining: 0, running: false },
  { total: 0, used: 0, remaining: 0, running: false },
])(
  'daily minutes reflect completed sessions: $total total, $used used',
  async ({ total, used, remaining, running }) => {
    const t = createConvexTest()
    const profile = (await seedProfile(t))!
    const nextRunAt = Date.now() + 60_000
    await t.run(async (ctx) => {
      await ctx.db.insert('warmupStates', {
        profileId: profile._id,
        day: 8,
        date: dayKey(),
        runsToday: 1,
        todayMinutes: total,
        minutesUsedToday: used,
        nextRunAt,
        activeRun: running ? { id: 'active', minutes: 5, restMinutes: 10 } : undefined,
      })
      await ctx.db.insert('accountProgress', {
        profileId: profile._id,

        activeDays: 8,
        outreachUsedToday: 0,
        outreachAllowanceToday: 0,
        nextRunAt: nextRunAt - 30_000,
        updatedAt: Date.now(),
      })
    })
    expect(await t.query(api.routines.profileDetails, { profileId: profile._id })).toMatchObject({
      dailyBudget: { date: dayKey(), total, remaining, running },
      nextRunAt,
    })
  },
)

test('yesterday budgets are hidden and next runs respect the later retry delay', async () => {
  const t = createConvexTest()
  const profile = (await seedProfile(t))!
  const nextRunAt = Date.now() + 120_000
  await t.run(async (ctx) => {
    await ctx.db.insert('warmupStates', {
      profileId: profile._id,
      day: 8,
      date: dayKey(Date.now() - 86_400_000),
      runsToday: 1,
      todayMinutes: 30,
      minutesUsedToday: 10,
      nextRunAt: nextRunAt - 60_000,
    })
    await ctx.db.insert('accountProgress', {
      profileId: profile._id,

      activeDays: 8,
      outreachUsedToday: 0,
      outreachAllowanceToday: 0,
      nextRunAt,
      updatedAt: Date.now(),
    })
  })
  expect(await t.query(api.routines.profileDetails, { profileId: profile._id })).toMatchObject({
    dailyBudget: null,
    nextRunAt,
  })
})

test('details prefer the enabled automation and ignore setup belonging to an old model', async () => {
  const t = createConvexTest()
  const model = (await seedModel(t))!
  const oldModel = (await seedModel(t, 'Old'))!
  const profile = (await seedProfile(t))!
  await t.run(async (ctx) => {
    await ctx.db.patch(profile._id, { modelId: model._id })
    for (const isActive of [false, true])
      await ctx.db.insert('automations', {
        name: isActive ? 'Enabled' : 'Disabled',
        modelIds: [model._id],
        isActive,
        routine: defaultRoutine,
        createdAt: 1,
        updatedAt: 1,
      })
    await ctx.db.insert('modelSetupStates', {
      profileId: profile._id,
      modelId: oldModel._id,
      startedAt: 1,
      postSourceIds: [],
      postDates: [],
      error: 'Old error',
    })
  })
  expect(await t.query(api.routines.profileDetails, { profileId: profile._id })).toMatchObject({
    automation: { name: 'Enabled', enabled: true },
    setup: null,
  })
})
