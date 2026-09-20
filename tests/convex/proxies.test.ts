import { expect, test } from 'vitest'

import { api } from '../../convex/_generated/api'
import { createConvexTest, insertDoc, seedProfile } from './helpers'

test('saving a profile auto-saves its proxy once', async () => {
  const t = createConvexTest()
  await seedProfile(t, {
    name: 'Profile A',
    proxy: 'http://host-a:8080:user:pass',
    proxyType: 'http',
  })
  await seedProfile(t, {
    name: 'Profile B',
    proxy: 'http://host-a:8080:user:pass',
    proxyType: 'http',
  })

  const rows = await t.query(api.proxies.list, {})
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    name: 'Profile A',
    proxy: 'http://user:pass@host-a:8080',
    proxyType: 'http',
  })
})

test('updating a profile with a new proxy auto-saves it', async () => {
  const t = createConvexTest()
  const profile = await seedProfile(t, { name: 'Profile A' })

  await t.mutation(api.profiles.mutations.updateById, {
    profileId: profile!._id,
    name: 'Profile A',
    proxy: 'socks5://host-b:1080:user:pass',
    proxyType: 'socks5',
  })

  const rows = await t.query(api.proxies.list, {})
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    proxy: 'socks5://user:pass@host-b:1080',
    proxyType: 'socks5',
  })
})

test('importFromProfiles backfills proxies stored on profiles', async () => {  const t = createConvexTest()
  // Insert directly to simulate profiles created before auto-save existed.
  await insertDoc(t, 'profiles', {
    createdAt: Date.now(),
    name: 'Legacy A',
    proxy: 'http://legacy:8080:user:pass',
    proxyType: 'http',
    status: 'idle',
    using: false,
  })
  await insertDoc(t, 'profiles', {
    createdAt: Date.now(),
    name: 'Legacy B',
    proxy: 'http://legacy:8080:user:pass',
    proxyType: 'http',
    status: 'idle',
    using: false,
  })

  const first = await t.mutation(api.proxies.importFromProfiles, {})
  expect(first.imported).toBe(1)

  const second = await t.mutation(api.proxies.importFromProfiles, {})
  expect(second.imported).toBe(0)

  const rows = await t.query(api.proxies.list, {})
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ name: 'Legacy A' })
})

test('proxies default to a limit of 3 and accept a custom limit', async () => {
  const t = createConvexTest()
  const a = await t.mutation(api.proxies.create, {
    name: 'Proxy A',
    proxy: 'http://a:8080:user:pass',
    proxyType: 'http',
  })
  const b = await t.mutation(api.proxies.create, {
    name: 'Proxy B',
    proxy: 'http://b:8080:user:pass',
    proxyType: 'http',
    maxProfiles: 1,
  })

  expect(a).toMatchObject({ maxProfiles: 3 })
  expect(b).toMatchObject({ maxProfiles: 1 })

  await expect(
    t.mutation(api.proxies.create, {
      name: 'Proxy C',
      proxy: 'http://c:8080',
      proxyType: 'http',
      maxProfiles: 0,
    }),
  ).rejects.toThrow()
})

test('blocks assigning a proxy that reached its limit', async () => {
  const t = createConvexTest()
  await t.mutation(api.proxies.create, {
    name: 'Solo',
    proxy: 'http://solo:8080:user:pass',
    proxyType: 'http',
    maxProfiles: 1,
  })
  await seedProfile(t, {
    name: 'Profile A',
    proxy: 'http://solo:8080:user:pass',
    proxyType: 'http',
  })

  await expect(
    seedProfile(t, {
      name: 'Profile B',
      proxy: 'http://solo:8080:user:pass',
      proxyType: 'http',
    }),
  ).rejects.toThrow(/already used by 1 profile/)
})

test('bare host:port values dedup against canonical rows', async () => {
  const t = createConvexTest()
  await seedProfile(t, {
    name: 'Profile A',
    proxy: 'host-a:8080:user:pass',
    proxyType: 'http',
  })
  await seedProfile(t, {
    name: 'Profile B',
    proxy: 'http://host-a:8080:user:pass',
    proxyType: 'http',
  })

  const rows = await t.query(api.proxies.list, {})
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    proxy: 'http://user:pass@host-a:8080',
    proxyType: 'http',
  })
})

test('edits that keep the current proxy pass even at the limit', async () => {
  const t = createConvexTest()
  // Direct inserts simulate profiles saved before the limit existed.
  let firstId: unknown
  for (const name of ['Legacy A', 'Legacy B']) {
    const row = await insertDoc(t, 'profiles', {
      createdAt: Date.now(),
      name,
      proxy: 'http://legacy:8080:user:pass',
      proxyType: 'http',
      status: 'idle',
      using: false,
    })
    firstId ??= row!._id
  }
  await t.mutation(api.proxies.create, {
    name: 'Legacy proxy',
    proxy: 'http://legacy:8080:user:pass',
    proxyType: 'http',
    maxProfiles: 1,
  })

  const updated = await t.mutation(api.profiles.mutations.updateById, {
    profileId: firstId as never,
    name: 'Legacy A renamed',
  })
  expect(updated).toMatchObject({ name: 'Legacy A renamed' })
})
