import { expect, test } from 'vitest'
import { api } from '../../convex/_generated/api'
import { createConvexTest, insertDoc, seedProfile } from './helpers'
import { parseProxy } from '../../server/shared/proxy'

const endpoint = { proxy: 'http://host:8080:user:pass', proxyType: 'http' }

test('unchanged endpoints reject limits below usage and allow the exact assignment count', async () => {
  const t = createConvexTest()
  const saved = await t.mutation(api.proxies.create, { name: 'Shared', ...endpoint, maxProfiles: 2 })
  await seedProfile(t, { name: 'A', ...endpoint })
  await seedProfile(t, { name: 'B', ...endpoint })
  // An equivalent spelling must follow the unchanged-endpoint branch too.
  const update = { id: saved!._id, name: 'Renamed', proxy: 'http://user:pass@HOST:8080/', proxyType: 'http' }
  await expect(t.mutation(api.proxies.update, { ...update, maxProfiles: 1 }))
    .rejects.toThrow(/Profile limit is too small/)
  expect(await t.query(api.proxies.list, {})).toMatchObject([{ name: 'Shared', maxProfiles: 2 }])
  await expect(t.mutation(api.proxies.update, { ...update, maxProfiles: 2 }))
    .resolves.toMatchObject({ name: 'Renamed', maxProfiles: 2 })
})

test('equivalent URL and legacy formats share limits on create and update', async () => {
  const t = createConvexTest()
  await t.mutation(api.proxies.create, { name: 'Solo', ...endpoint, maxProfiles: 1 })
  await seedProfile(t, { name: 'A', ...endpoint })
  const equivalent = 'http://user:pass@HOST:8080/'
  expect(parseProxy(endpoint.proxy)).toEqual(parseProxy(equivalent))
  await expect(seedProfile(t, { name: 'B', proxy: equivalent })).rejects.toThrow(/limit 1/)
  const direct = await seedProfile(t, { name: 'Direct' })
  await expect(t.mutation(api.profiles.mutations.updateById, {
    profileId: direct!._id, name: 'Direct', proxy: equivalent,
  })).rejects.toThrow(/limit 1/)
  expect(await t.query(api.proxies.list, {})).toHaveLength(1)
})

test('proxy edits atomically update all assigned profiles and retain their usage limit', async () => {
  const t = createConvexTest()
  const saved = await t.mutation(api.proxies.create, { name: 'Shared', ...endpoint, maxProfiles: 2 })
  const first = await seedProfile(t, { name: 'A', ...endpoint })
  // Existing unnormalized rows must also follow edits.
  const second = await insertDoc(t, 'profiles', { name: 'B', ...endpoint, using: false, createdAt: 1 })
  await t.mutation(api.proxies.update, {
    id: saved!._id, name: 'Shared', proxy: 'socks5://host:1080:user:new', proxyType: 'socks5', maxProfiles: 2,
  })
  for (const id of [first!._id, second!._id]) {
    expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({
      proxy: 'socks5://user:new@host:1080', proxyType: 'socks5', mode: 'proxy',
    })
  }
  await expect(seedProfile(t, { name: 'C', proxy: 'socks5://user:new@host:1080' })).rejects.toThrow(/limit 2/)
  expect(await t.mutation(api.proxies.importFromProfiles, {})).toEqual({ imported: 0 })
})

test('connection changes are rejected while assigned profiles run', async () => {
  const t = createConvexTest()
  const p = await seedProfile(t, { name: 'A', ...endpoint })
  const [saved] = await t.query(api.proxies.list, {})
  await t.run(ctx => ctx.db.patch(p!._id, { using: true, status: 'running' }))
  await expect(t.mutation(api.proxies.update, {
    id: saved._id, name: saved.name, proxy: 'http://other:8080', proxyType: 'http',
  })).rejects.toThrow(/Stop assigned profiles/)
  expect(await t.query(api.proxies.list, {})).toMatchObject([{ proxy: 'http://user:pass@host:8080' }])
  // Cosmetic edits remain available.
  await t.mutation(api.proxies.update, { id: saved._id, name: 'Renamed', ...endpoint })
})

test('assigned proxies cannot be deleted; unassigned deletion stays deleted after import', async () => {
  const t = createConvexTest()
  const saved = await t.mutation(api.proxies.create, { name: 'Solo', ...endpoint, maxProfiles: 1 })
  const p = await seedProfile(t, { name: 'A', ...endpoint })
  await expect(t.mutation(api.proxies.remove, { id: saved!._id })).rejects.toThrow(/Reassign profiles/)
  expect(await t.query(api.proxies.list, {})).toMatchObject([{ name: 'Solo', maxProfiles: 1 }])
  await t.mutation(api.profiles.mutations.updateById, { profileId: p!._id, name: 'A', proxy: '' })
  await t.mutation(api.proxies.remove, { id: saved!._id })
  await t.mutation(api.proxies.importFromProfiles, {})
  expect(await t.query(api.proxies.list, {})).toHaveLength(0)
})

test('duplicate endpoints are rejected on both create and edit', async () => {
  const t = createConvexTest()
  await t.mutation(api.proxies.create, { name: 'First', ...endpoint })
  await expect(t.mutation(api.proxies.create, {
    name: 'Duplicate', proxy: 'http://user:pass@HOST:8080/', proxyType: 'http', maxProfiles: 5,
  })).rejects.toThrow(/Proxy already exists/)
  const second = await t.mutation(api.proxies.create, { name: 'Second', proxy: 'other:8080', proxyType: 'http' })
  await expect(t.mutation(api.proxies.update, { id: second!._id, name: 'Second', ...endpoint })).rejects.toThrow(/Proxy already exists/)
})

test('explicit SOCKS5 and HTTPS schemes survive auto-save and import without a type field', async () => {
  const t = createConvexTest()
  const p = await seedProfile(t, { name: 'Socks', proxy: 'socks5://host:1080' })
  expect(p).toMatchObject({ proxy: 'socks5://host:1080', proxyType: 'socks5' })
  await insertDoc(t, 'profiles', { name: 'Secure', proxy: 'https://host:8443', using: false, createdAt: 1 })
  await t.mutation(api.proxies.importFromProfiles, {})
  expect(await t.query(api.proxies.list, {})).toEqual(expect.arrayContaining([
    expect.objectContaining({ proxy: 'socks5://host:1080', proxyType: 'socks5' }),
    expect.objectContaining({ proxy: 'https://host:8443', proxyType: 'https' }),
  ]))
})

test('malformed proxy writes fail without exposing credentials or storing partial rows', async () => {
  const t = createConvexTest()
  await expect(seedProfile(t, { name: 'Bad', proxy: 'http://user:secret@host:bad' })).rejects.toThrow('Invalid proxy URL or protocol')
  expect(await t.query(api.proxies.list, {})).toHaveLength(0)
})
