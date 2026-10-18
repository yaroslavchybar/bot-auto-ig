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
      modelIds: [model._id],
      igLoggedIn: true,
      outreachReady: true,
      cookiesJson: 'private-cookies',
      instagramSessionId: 'private-session',
    })
    const listId = await ctx.db.insert('leadLists', { name: 'Recipients', createdAt: 1 })
    const automationId = await ctx.db.insert('automations', {
      name: 'Example automation',
      nodes: [],
      edges: [],
      createdAt: 1,
      updatedAt: 1,
      isActive: true,
      modelIds: [model._id],
      routine: {
        ...defaultRoutine,
        initialDms: 5,
        maxDms: 10,
        outreachEnabled: true,
        leadListId: listId,
      },
    })
    await ctx.db.insert('accountProgress', {
      profileId: profile._id,
      paused: false,
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
  })
  await t.mutation(api.profiles.mutations.setPaused, { profileId: profile._id, paused: true })
  expect((await t.query(api.routines.profileDetails, { profileId: profile._id }))?.paused).toBe(
    true,
  )
  await t.run((ctx) => ctx.db.delete(profile._id))
  expect(await t.query(api.routines.profileDetails, { profileId: profile._id })).toBeNull()
})

test('details prefer the enabled automation and ignore setup belonging to an old model', async () => {
  const t = createConvexTest()
  const model = (await seedModel(t))!
  const oldModel = (await seedModel(t, 'Old'))!
  const profile = (await seedProfile(t))!
  await t.run(async (ctx) => {
    await ctx.db.patch(profile._id, { modelIds: [model._id] })
    for (const isActive of [false, true])
      await ctx.db.insert('automations', {
        name: isActive ? 'Enabled' : 'Disabled',
        modelIds: [model._id],
        isActive,
        routine: defaultRoutine,
        nodes: [],
        edges: [],
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
