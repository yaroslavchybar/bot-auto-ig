import { expect, test, vi } from 'vite-plus/test'

import { api, internal } from '../../convex/_generated/api'
import { createConvexTest, insertDoc, seedModel, seedProfile } from './helpers'

test('creates, updates, and removes models while clearing profile links', async () => {
  const t = createConvexTest()
  const list = await seedModel(t, 'List A')
  const profile = await insertDoc(t, 'profiles', {
    createdAt: Date.now(),
    name: 'Profile A',
    inUse: false,
    modelId: list!._id,
  })

  const updated = await t.mutation(api.models.update, {
    id: list!._id,
    name: 'List B',
  })
  const removed = await t.mutation(api.models.remove, { id: list!._id })
  const linkedProfile = await t.run(async (ctx) => ctx.db.get(profile!._id))

  expect(updated?.name).toBe('List B')
  expect(removed).toBe(true)
  expect(linkedProfile?.modelId).toBeUndefined()
})

test('saves a model name pool for warmup', async () => {
  const t = createConvexTest()
  const model = await t.mutation(api.models.create, {
    name: 'Anna', baseFullName: 'Anna Kowalska',
    fullNameVariations: [' Anna Kowalska ', 'Anna M. Kowalska', 'Anna M. Kowalska'],
    usernames: ['anna.kowalska'],
  })
  expect(model?.fullNameVariations).toEqual(['Anna Kowalska', 'Anna M. Kowalska'])

  const updated = await t.mutation(api.models.update, {
    id: model!._id, name: 'Anna', fullNameVariations: ['Anna K. Kowalska'],
  })
  expect(updated?.fullNameVariations).toEqual(['Anna K. Kowalska'])
  expect(updated?.usernames).toEqual(['anna.kowalska'])
})

test('saves emoji in full-name variations', async () => {
  const t = createConvexTest()
  const model = await t.mutation(api.models.create, { name: 'Nastya' })
  const fullNameVariations = ['Nastya✨', 'Nastya ❤️', 'Nastya👩🏽‍💻', 'Nastya🇺🇦']

  const updated = await t.mutation(api.models.update, {
    id: model!._id, name: 'Nastya', fullNameVariations,
  })

  expect(updated?.fullNameVariations).toEqual(fullNameVariations)
})

test('removing one model deletes only its setup progress and shared names', async () => {
  const t = createConvexTest()
  const first = (await seedModel(t, 'First'))!
  const second = (await seedModel(t, 'Second'))!
  const firstProfile = (await seedProfile(t, { name: 'First profile' }))!
  const secondProfile = (await seedProfile(t, { name: 'Second profile' }))!
  await t.run(async ctx => {
    for (const [modelId, profileId] of [[first._id, firstProfile._id], [second._id, secondProfile._id]] as const) {
      await ctx.db.insert('modelSetupStates', { modelId, profileId, startedAt: 1,
        postSourceIds: [], postDates: [] })
      await ctx.db.insert('modelSetupGroupNames', { modelId, group: 0, name: 'Shared name' })
    }
  })

  await t.mutation(api.models.remove, { id: first._id })
  const remaining = await t.run(async ctx => ({
    states: await ctx.db.query('modelSetupStates').collect(),
    groups: await ctx.db.query('modelSetupGroupNames').collect(),
  }))
  expect(remaining.states.map(row => row.modelId)).toEqual([second._id])
  expect(remaining.groups.map(row => row.modelId)).toEqual([second._id])
})

test('deleted models queue native cleanup once and keep it until acknowledged', async () => {
  vi.stubEnv('INTERNAL_API_KEY', 'test-bridge')
  try {
    const t = createConvexTest()
    const first = (await seedModel(t, 'First'))!
    const second = (await seedModel(t, 'Second'))!
    const live = (await seedModel(t, 'Live'))!
    await t.mutation(api.models.remove, { id: first._id })
    await t.mutation(api.models.remove, { id: first._id })
    await t.mutation(api.models.remove, { id: second._id })
    await t.mutation(internal.models.queueContentCleanupInternal, { contentKey: live._id })
    await t.mutation(internal.models.queueContentCleanupInternal, { contentKey: first._id })
    const work = () => t.query(api.profiles.queries.maintenanceWork, { bridgeToken: 'test-bridge' })
    expect(await work()).toEqual({ profileIds: [], contentKeys: [first._id, second._id] })
    await t.mutation(internal.models.finishContentCleanupInternal, { contentKey: first._id })
    await t.mutation(internal.models.finishContentCleanupInternal, { contentKey: first._id })
    expect((await work()).contentKeys).toEqual([second._id])
    expect(await t.query(api.models.list, {})).toMatchObject([{ _id: live._id }])
  } finally {
    vi.unstubAllEnvs()
  }
})

test('migrated models protect their original content key until deletion', async () => {
  const t = createConvexTest()
  const id = await t.run(ctx => ctx.db.insert('models', {
    name: 'Migrated', contentKey: 'original-model', createdAt: 1,
  }))
  await t.mutation(internal.models.queueContentCleanupInternal, { contentKey: 'original-model' })
  expect(await t.run(ctx => ctx.db.query('modelContentCleanup').collect())).toEqual([])
  await t.mutation(api.models.remove, { id })
  expect(await t.run(ctx => ctx.db.query('modelContentCleanup').collect()))
    .toMatchObject([{ contentKey: 'original-model' }])
})
