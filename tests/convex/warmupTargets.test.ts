import { expect, test, vi } from 'vite-plus/test'
import { api, internal } from '../../convex/_generated/api'
import { defaultRoutine } from '../../convex/routinePolicy'
import { createConvexTest, seedList, seedProfile } from './helpers'

async function setup(min = 3, max = 6) {
  const t = createConvexTest()
  const model = (await seedList(t))!
  const automation = (await t.mutation(api.automations.mutations.create, {
    name: 'Random setup', nodes: [], edges: [], listIds: [model._id],
    routine: { ...defaultRoutine, warmupMinPosts: min, warmupMaxPosts: max },
  }))!
  const profile = (await seedProfile(t))!
  await t.mutation(api.profiles.mutations.bulkAddToList, { profileIds: [profile._id], listId: model._id })
  const enroll = () => t.mutation(internal.igAccounts.modelSetupEnrollInternal, {
    profileId: profile._id, modelId: model._id, startedAt: 1,
  })
  return { t, model, automation, profile, enroll }
}

test('each account draws and retains its own warm-up post target', async () => {
  const { t, model, profile, enroll } = await setup()
  const rng = vi.spyOn(Math, 'random').mockReturnValue(0)
  try {
    expect((await enroll())?.postTarget).toBe(3)
    rng.mockReturnValue(0.999)
    const other = (await seedProfile(t, { name: 'Other' }))!
    await t.mutation(api.profiles.mutations.bulkAddToList, { profileIds: [other._id], listId: model._id })
    expect((await t.mutation(internal.igAccounts.modelSetupEnrollInternal, {
      profileId: other._id, modelId: model._id, startedAt: 1,
    }))?.postTarget).toBe(6)
    expect((await enroll())?.postTarget).toBe(3)
    expect((await t.query(internal.igAccounts.modelSetupListInternal, {}))
      .find(row => row.profileId === profile._id)?.postTarget).toBe(3)
  } finally { rng.mockRestore() }
})

test.each(['confirmed', 'reviewed'])('the saved post target gates %s posts', async mode => {
  const { t, model, profile, enroll } = await setup(3, 3)
  await enroll()
  const patch = (updates: Record<string, unknown>) => t.mutation(internal.igAccounts.modelSetupPatchInternal, {
    profileId: profile._id, modelId: model._id, patch: updates, clear: [],
  })
  await patch({ postSourceIds: ['p1', 'p2'], postDates: ['2026-09-25', '2026-09-26'] })
  await expect(patch({ outreachReadyMarked: true })).rejects.toThrow('3 recorded posts')
  if (mode === 'reviewed') {
    await patch({ pending: { kind: 'post', sourceId: 'p3', date: '2026-09-27' } })
    await t.mutation(internal.igAccounts.modelSetupReconcileInternal, { profileId: profile._id, resolution: 'completed' })
  } else {
    await patch({ postSourceIds: ['p1', 'p2', 'p3'] })
    await expect(patch({ outreachReadyMarked: true })).rejects.toThrow('3 recorded posts')
    await patch({ postDates: ['2026-09-25', '2026-09-26', '2026-09-27'] })
  }
  const state = (await t.query(internal.igAccounts.modelSetupListInternal, {}))[0]!
  expect(state).toMatchObject({ postTarget: 3, outreachReadyMarked: true, postSourceIds: ['p1', 'p2', 'p3'] })
  expect((await t.query(internal.profiles.queries.getByIdInternal, { profileId: profile._id }))?.outreachReady).toBe(true)
})

test('changing the range updates unfinished setups and preserves completed accounts and posts', async () => {
  const { t, model, automation, profile, enroll } = await setup(9, 9)
  await enroll()
  await t.mutation(internal.igAccounts.modelSetupPatchInternal, { profileId: profile._id, modelId: model._id,
    patch: { postSourceIds: ['p1', 'p2'], postDates: ['2026-09-25', '2026-09-26'] }, clear: [] })
  const done = (await seedProfile(t, { name: 'Done' }))!
  await t.mutation(api.profiles.mutations.bulkAddToList, { profileIds: [done._id], listId: model._id })
  await t.mutation(internal.igAccounts.modelSetupEnrollInternal, { profileId: done._id, modelId: model._id, startedAt: 1 })
  await t.mutation(internal.igAccounts.modelSetupPatchInternal, { profileId: done._id, modelId: model._id,
    patch: { postSourceIds: Array.from({ length: 9 }, (_, i) => `p${i}`),
      postDates: Array.from({ length: 9 }, (_, i) => `2026-09-${i + 1}`) }, clear: [] })
  const rng = vi.spyOn(Math, 'random').mockReturnValue(0.999)
  try {
    const policy = { ...automation.routine!, warmupMinPosts: 3, warmupMaxPosts: 6 }
    await t.mutation(api.automations.mutations.update, { id: automation._id, routine: policy })
    const states = await t.query(internal.igAccounts.modelSetupListInternal, {})
    expect(states.find(row => row.profileId === profile._id)).toMatchObject({ postTarget: 6, postSourceIds: ['p1', 'p2'] })
    expect(states.find(row => row.profileId === done._id)).toMatchObject({ postTarget: 9, outreachReadyMarked: true })
    rng.mockReturnValue(0)
    await t.mutation(api.automations.mutations.update, { id: automation._id, routine: { ...policy, headless: true } })
    expect((await enroll())?.postTarget).toBe(6)
    await t.mutation(api.automations.mutations.update, { id: automation._id, routine: { ...policy, warmupMinPosts: 2, warmupMaxPosts: 2 } })
    expect((await enroll())).toMatchObject({ postTarget: 2, outreachReadyMarked: true, postSourceIds: ['p1', 'p2'] })
    expect((await t.query(internal.profiles.queries.getByIdInternal, { profileId: profile._id }))?.outreachReady).toBe(true)
  } finally { rng.mockRestore() }
})

test.each([2, 3])('a model-only update applies the existing policy to destination accounts with %s posts', async postCount => {
  const { t, automation, profile, enroll } = await setup(3, 6)
  const sourceState = await enroll()
  const destination = (await seedList(t, 'Destination'))!
  const recipient = (await seedProfile(t, { name: 'Destination account' }))!
  await t.mutation(api.profiles.mutations.bulkAddToList, {
    profileIds: [recipient._id], listId: destination._id,
  })
  await t.mutation(internal.igAccounts.modelSetupEnrollInternal, {
    profileId: recipient._id, modelId: destination._id, startedAt: 1,
  })
  const postSourceIds = Array.from({ length: postCount }, (_, i) => `p${i}`)
  const postDates = Array.from({ length: postCount }, (_, i) => `2026-09-${i + 1}`)
  await t.mutation(internal.igAccounts.modelSetupPatchInternal, {
    profileId: recipient._id, modelId: destination._id, patch: { postSourceIds, postDates }, clear: [],
  })
  const rng = vi.spyOn(Math, 'random').mockReturnValue(0)
  try {
    const updated = await t.mutation(api.automations.mutations.update, {
      id: automation._id, listIds: [destination._id],
    })
    expect(updated?.routine).toEqual(automation.routine)
    const states = await t.query(internal.igAccounts.modelSetupListInternal, {})
    expect(states.find(row => row.profileId === recipient._id))
      .toMatchObject({ postTarget: 3, postSourceIds, postDates })
    expect((await t.query(internal.profiles.queries.getByIdInternal, {
      profileId: recipient._id,
    }))?.outreachReady).toBe(postCount >= 3)
    expect(states.find(row => row.profileId === profile._id)).toEqual(sourceState)
    rng.mockReturnValue(0.999)
    await t.mutation(api.automations.mutations.update, {
      id: automation._id, listIds: [destination._id],
    })
    expect((await t.query(internal.igAccounts.modelSetupListInternal, {}))
      .find(row => row.profileId === recipient._id)?.postTarget).toBe(3)
  } finally { rng.mockRestore() }
})
