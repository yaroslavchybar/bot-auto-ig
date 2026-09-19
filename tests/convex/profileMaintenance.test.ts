import { expect, test } from 'vitest'
import { api, internal } from '../../convex/_generated/api'
import { createConvexTest, seedList, seedProfile } from './helpers'

test('create and rename reject Windows device names, including extensions', async () => {
  const t = createConvexTest()
  const profile = (await seedProfile(t, { name: 'Valid' }))!
  for (const name of ['CON', 'con.txt', 'PRN', 'AUX.json', 'NUL', 'COM1', 'com9.txt', 'LPT1', 'lpt9.log']) {
    await expect(t.mutation(api.profiles.mutations.create, { name })).rejects.toThrow(/Invalid profile name/)
    await expect(t.mutation(api.profiles.mutations.updateById, { profileId: profile._id, name })).rejects.toThrow(/Invalid profile name/)
  }
  expect((await t.query(api.profiles.queries.getById, { profileId: profile._id }))?.name).toBe('Valid')
})

test('deletion remains pending through runtime updates and blocks edits and scheduling', async () => {
  const t = createConvexTest()
  const profile = (await seedProfile(t, { name: 'Delete me' }))!
  const list = (await seedList(t, 'List'))!
  await t.mutation(api.profiles.mutations.bulkAddToList, { profileIds: [profile._id], listId: list._id })
  await expect(t.mutation(internal.profiles.mutations.removeByIdInternal, { profileId: profile._id })).rejects.toThrow(/Begin profile deletion/)
  await t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: profile.name })
  await t.mutation(internal.profiles.mutations.syncStatusInternal, { name: profile.name, status: 'idle', using: false })
  expect(await t.query(api.profiles.queries.getById, { profileId: profile._id })).toMatchObject({ status: 'deleting' })
  await expect(t.mutation(api.profiles.mutations.updateById, { profileId: profile._id, name: 'Renamed' })).rejects.toThrow(/maintenance/)
  await expect(t.mutation(api.profiles.mutations.create, { name: 'delete ME' })).rejects.toThrow(/already in use/)
  expect(await t.query(internal.profiles.queries.getAvailableForListsInternal, { listIds: [list._id], cooldownMinutes: 0 })).toEqual([])
  await t.mutation(internal.profiles.mutations.removeByIdInternal, { profileId: profile._id })
  await t.mutation(internal.profiles.mutations.removeByIdInternal, { profileId: profile._id })
  expect(await t.query(api.profiles.queries.getById, { profileId: profile._id })).toBeNull()
})

test('rename reserves both names until filesystem work is acknowledged', async () => {
  const t = createConvexTest()
  const profile = (await seedProfile(t, { name: 'Old' }))!
  await t.mutation(internal.profiles.mutations.updateByNameInternal, { oldName: 'Old', name: 'New' })
  expect(await t.query(api.profiles.queries.getById, { profileId: profile._id })).toMatchObject({ name: 'New', renameFrom: 'Old' })
  await expect(t.mutation(api.profiles.mutations.create, { name: 'Old' })).rejects.toThrow(/already in use/)
  await expect(t.mutation(api.profiles.mutations.updateById, { profileId: profile._id, name: 'Next' })).rejects.toThrow(/maintenance/)
  await t.mutation(internal.profiles.mutations.finishRenameInternal, { profileId: profile._id })
  expect((await t.query(api.profiles.queries.getById, { profileId: profile._id }))?.renameFrom).toBeUndefined()
  await t.mutation(api.profiles.mutations.create, { name: 'Old' })
})
