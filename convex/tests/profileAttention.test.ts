import { expect, test } from 'vite-plus/test'
import { api } from '../_generated/api'
import { createConvexTest, seedModel, seedProfile } from '../../tests/convex/helpers'

test('profile list attention reflects current errors and pending setup, and clears when resolved', async () => {
  const t = createConvexTest()
  const profile = (await seedProfile(t))!
  const model = (await seedModel(t))!
  const oldModel = (await seedModel(t, 'Old'))!
  const attention = async () => (await t.query(api.profiles.queries.listPage,
    { search: '', cursor: null, pageSize: 25 })).page.find(row => row._id === profile._id)?.attention
  const { setupId, progressId } = await t.run(async ctx => {
    await ctx.db.patch(profile._id, { modelIds: [model._id] })
    await ctx.db.insert('modelSetupStates', { profileId: profile._id, modelId: oldModel._id,
      startedAt: 1, postSourceIds: [], postDates: [], error: 'Old failure' })
    const setupId = await ctx.db.insert('modelSetupStates', { profileId: profile._id, modelId: model._id,
      startedAt: 1, postSourceIds: [], postDates: [] })
    const progressId = await ctx.db.insert('accountProgress', { profileId: profile._id, paused: false,
      activeDays: 0, outreachUsedToday: 0, outreachAllowanceToday: 0, nextRunAt: 0, updatedAt: 1 })
    return { setupId, progressId }
  })
  expect(await attention()).toBeUndefined()
  await t.run(ctx => ctx.db.patch(setupId, { pending: { kind: 'post', date: '2026-10-18' }, error: 'Check post' }))
  expect(await attention()).toBe('review')
  await t.run(ctx => ctx.db.patch(progressId, { issue: 'Delivery needs review' }))
  expect(await attention()).toBe('error')
  await t.mutation(api.routines.setAccount, { profileId: profile._id, clearIssue: true })
  expect(await attention()).toBe('review')
  await t.run(ctx => ctx.db.patch(setupId, { pending: undefined }))
  expect(await attention()).toBe('error')
  await t.run(ctx => ctx.db.patch(setupId, { error: undefined }))
  await t.run(ctx => ctx.db.patch(progressId, { issue: 'Browser worker stopped' }))
  expect(await attention()).toBeUndefined()
  await t.run(ctx => ctx.db.patch(profile._id, { status: 'failed' }))
  expect(await attention()).toBe('error')
  await t.run(ctx => ctx.db.patch(profile._id, { status: 'idle' }))
  expect(await attention()).toBeUndefined()
})

test('profile attention considers all assigned models while ignoring unassigned setup', async () => {
  const t = createConvexTest()
  const profile = (await seedProfile(t))!
  const first = (await seedModel(t, 'First'))!
  const second = (await seedModel(t, 'Second'))!
  const unassigned = (await seedModel(t, 'Unassigned'))!
  const secondSetup = await t.run(async ctx => {
    await ctx.db.patch(profile._id, { modelIds: [first._id, second._id] })
    for (const model of [first, unassigned]) {
      await ctx.db.insert('modelSetupStates', {
        profileId: profile._id, modelId: model._id, startedAt: 1, postSourceIds: [], postDates: [],
        ...(model === unassigned ? { error: 'Old error', pending: { kind: 'post' as const, date: '2026-10-18' } } : {}),
      })
    }
    return ctx.db.insert('modelSetupStates', {
      profileId: profile._id, modelId: second._id, startedAt: 1, postSourceIds: [], postDates: [],
    })
  })
  const attention = async () => (await t.query(api.profiles.queries.listPage,
    { search: '', cursor: null, pageSize: 25 })).page.find(row => row._id === profile._id)?.attention
  expect(await attention()).toBeUndefined()
  await t.run(ctx => ctx.db.patch(secondSetup, { error: 'Second model failed' }))
  expect(await attention()).toBe('error')
  await t.run(ctx => ctx.db.patch(secondSetup, { pending: { kind: 'post', date: '2026-10-18' } }))
  expect(await attention()).toBe('review')
  await t.run(ctx => ctx.db.patch(secondSetup, { pending: undefined, error: undefined }))
  expect(await attention()).toBeUndefined()
})
