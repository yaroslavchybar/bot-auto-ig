import { expect, test } from 'vite-plus/test'

import { api } from '../../convex/_generated/api'
import { createConvexTest, insertDoc, seedList, seedProfile } from './helpers'

test('creates, updates, and removes lists while clearing profile links', async () => {
  const t = createConvexTest()
  const list = await seedList(t, 'List A')
  const profile = await insertDoc(t, 'profiles', {
    createdAt: Date.now(),
    name: 'Profile A',
    using: false,
    mode: 'direct',
    listIds: [list!._id],
  })

  const updated = await t.mutation(api.lists.update, {
    id: list!._id,
    name: 'List B',
  })
  const removed = await t.mutation(api.lists.remove, { id: list!._id })
  const linkedProfile = await t.run(async (ctx) => ctx.db.get(profile!._id))

  expect(updated?.name).toBe('List B')
  expect(removed).toBe(true)
  expect(linkedProfile?.listIds).toEqual([])
})

test('saves a model name pool for warmup', async () => {
  const t = createConvexTest()
  const model = await t.mutation(api.lists.create, {
    name: 'Anna', fullName: 'Anna Kowalska',
    fullNames: [' Anna Kowalska ', 'Anna M. Kowalska', 'Anna M. Kowalska'],
    usernames: ['anna.kowalska'],
  })
  expect(model?.fullNames).toEqual(['Anna Kowalska', 'Anna M. Kowalska'])

  const updated = await t.mutation(api.lists.update, {
    id: model!._id, name: 'Anna', fullNames: ['Anna K. Kowalska'],
  })
  expect(updated?.fullNames).toEqual(['Anna K. Kowalska'])
  expect(updated?.usernames).toEqual(['anna.kowalska'])
})

test('saves emoji in full-name variations', async () => {
  const t = createConvexTest()
  const model = await t.mutation(api.lists.create, { name: 'Nastya' })
  const fullNames = ['Nastya✨', 'Nastya ❤️', 'Nastya👩🏽‍💻', 'Nastya🇺🇦']

  const updated = await t.mutation(api.lists.update, {
    id: model!._id, name: 'Nastya', fullNames,
  })

  expect(updated?.fullNames).toEqual(fullNames)
})

test('removing one model deletes only its setup progress and shared names', async () => {
  const t = createConvexTest()
  const first = (await seedList(t, 'First'))!
  const second = (await seedList(t, 'Second'))!
  const firstProfile = (await seedProfile(t, { name: 'First profile' }))!
  const secondProfile = (await seedProfile(t, { name: 'Second profile' }))!
  await t.run(async ctx => {
    for (const [modelId, profileId] of [[first._id, firstProfile._id], [second._id, secondProfile._id]] as const) {
      await ctx.db.insert('modelSetupStates', { modelId, profileId, startedAt: 1,
        postSourceIds: [], postDates: [] })
      await ctx.db.insert('modelSetupGroupNames', { modelId, group: 0, name: 'Shared name' })
    }
  })

  await t.mutation(api.lists.remove, { id: first._id })
  const remaining = await t.run(async ctx => ({
    states: await ctx.db.query('modelSetupStates').collect(),
    groups: await ctx.db.query('modelSetupGroupNames').collect(),
  }))
  expect(remaining.states.map(row => row.modelId)).toEqual([second._id])
  expect(remaining.groups.map(row => row.modelId)).toEqual([second._id])
})
