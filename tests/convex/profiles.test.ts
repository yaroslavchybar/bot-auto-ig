import { expect, test } from 'vitest'

import { api, internal } from '../../convex/_generated/api'
import { createConvexTest, seedList, seedProfile } from './helpers'

test('creates profiles and selects available profiles by list with cooldown logic', async () => {
  const t = createConvexTest()
  const list = await seedList(t, 'List A')
  const profile = await seedProfile(t, {
    name: 'Profile A',
    proxy: 'http://proxy',
    cookiesJson: '[{"name":"sessionid","value":"cookie-1","domain":".instagram.com","path":"/"}]',
  })

  await t.mutation(api.profiles.mutations.bulkAddToList, {
    profileIds: [profile!._id],
    listId: list!._id,
  })

  const available = await t.query(internal.profiles.queries.getAvailableForListsInternal, {
    listIds: [String(list!._id)],
    cooldownMinutes: 10,
  })

  expect(profile).toMatchObject({
    mode: 'proxy',
    cookiesJson: '[{"name":"sessionid","value":"cookie-1","domain":".instagram.com","path":"/"}]',
  })
  expect(available).toHaveLength(1)
  expect(available[0]?._id).toBe(profile!._id)
})

test('syncs profile status', async () => {
  const t = createConvexTest()
  const list = await seedList(t, 'List A')
  const profile = await seedProfile(t, { name: 'Profile B' })

  await t.mutation(api.profiles.mutations.bulkAddToList, {
    profileIds: [profile!._id],
    listId: list!._id,
  })
  await t.mutation(internal.profiles.mutations.syncStatusInternal, {
    name: 'Profile B',
    status: 'running',
    using: true,
  })
  await t.mutation(internal.profiles.mutations.syncStatusInternal, {
    name: 'Profile B',
    status: 'idle',
    using: false,
  })

  const updated = await t.query(api.profiles.queries.getById, {
    profileId: profile!._id,
  })

  expect(updated).toMatchObject({
    status: 'idle',
    using: false,
  })
})

test('updates profile cookies by id and clears them when empty string is provided', async () => {
  const t = createConvexTest()
  const profile = await seedProfile(t, {
    name: 'Profile C',
    cookiesJson: '[{"name":"csrftoken","value":"abc","domain":".instagram.com","path":"/"}]',
  })

  const updated = await t.mutation(api.profiles.mutations.updateById, {
    profileId: profile!._id,
    name: 'Profile C',
    cookiesJson: '[{"name":"sessionid","value":"updated","domain":".instagram.com","path":"/"}]',
  })
  expect(updated).toMatchObject({
    cookiesJson: '[{"name":"sessionid","value":"updated","domain":".instagram.com","path":"/"}]',
  })

  const cleared = await t.mutation(api.profiles.mutations.updateById, {
    profileId: profile!._id,
    name: 'Profile C',
    cookiesJson: '   ',
  })
  expect(cleared?.cookiesJson).toBeUndefined()
})

test('editing other fields preserves cookies saved during browser shutdown', async () => {
  const t = createConvexTest()
  const profile = await seedProfile(t, { name: 'Live profile', cookiesJson: 'old' })
  await t.mutation(internal.profiles.mutations.updateByNameInternal, {
    oldName: profile!.name, name: profile!.name, cookiesJson: 'fresh',
  })
  const updated = await t.mutation(internal.profiles.mutations.updateByNameInternal, {
    oldName: profile!.name, name: 'Renamed profile', proxy: '',
  })
  expect(updated?.cookiesJson).toBe('fresh')
})

test('model batch creation assigns distinct proxy slots and is atomic when capacity is short', async () => {
  const t = createConvexTest()
  const model = await seedList(t, 'Model A')
  await t.run(ctx => ctx.db.insert('proxies', { name: 'Malformed', proxy: 'http://bad/path',
    proxyType: 'http', purpose: 'work', createdAt: 1 }))
  await t.mutation(api.proxies.create, { name: 'P1', proxy: '1.2.3.4:8080:user:pass', proxyType: 'http' })
  await t.mutation(internal.igAccounts.importEncryptedInternal, { rows:
    ['one', 'two', 'three', 'four'].map((_, index) => ({
      usernameHash: String(index + 1).repeat(64), ciphertext: `v1.encrypted-${index}`,
    })) })
  const accounts = (await t.query(internal.igAccounts.availableInternal, { count: 4 })).page
  const created = await t.mutation(internal.profiles.mutations.createForModelInternal,
    { modelId: model!._id, accounts: accounts.slice(0, 3).map((account, index) =>
      ({ id: account._id, username: ['one', 'two', 'three'][index] })) })
  expect(created).toHaveLength(3)
  const rows = await t.query(api.profiles.queries.list, {})
  expect(rows).toHaveLength(3)
  expect(rows.every(row => row.listIds?.includes(model!._id))).toBe(true)
  expect(rows.map(row => row.igAccountId)).toEqual(accounts.slice(0, 3).map(account => account._id))
  expect(await t.query(internal.profiles.queries.listAssignedInternal, { listId: model!._id }))
    .toHaveLength(3)
  expect((await t.query(internal.igAccounts.availableInternal, { count: 4 })).page).toHaveLength(1)
  await expect(t.mutation(internal.profiles.mutations.createForModelInternal,
    { modelId: model!._id, accounts: [{ id: accounts[3]._id, username: 'four' }] })).rejects.toThrow(/capacity/)
  expect(await t.query(api.profiles.queries.list, {})).toHaveLength(3)
  expect((await t.query(internal.igAccounts.availableInternal, { count: 4 })).page).toHaveLength(1)
})

test('model batch creation ignores login proxies', async () => {
  const t = createConvexTest()
  const model = await seedList(t, 'Model B')
  await t.mutation(api.proxies.create, { name: 'Login only', proxy: 'login:8080',
    proxyType: 'http', purpose: 'login', country: 'us' })
  await t.mutation(internal.igAccounts.importEncryptedInternal, { rows: [
    { usernameHash: 'f'.repeat(64), ciphertext: 'v1.encrypted' },
  ] })
  const [account] = (await t.query(internal.igAccounts.availableInternal, { count: 1 })).page
  await expect(t.mutation(internal.profiles.mutations.createForModelInternal, {
    modelId: model!._id, accounts: [{ id: account._id, username: 'model_account' }],
  })).rejects.toThrow(/capacity/)
})
