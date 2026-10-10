import { expect, test } from 'vite-plus/test'

import { api, internal } from '../../convex/_generated/api'
import { createConvexTest, insertDoc, seedProfile } from './helpers'

test('TXT import normalizes proxies, skips duplicates, and defaults to three profiles', async () => {
  const t = createConvexTest()
  const result = await t.mutation(api.proxies.importMany, {
    text: '203.0.113.10:5432:demo:example\n203.0.113.10:5432:demo:example',
    proxyType: 'http', purpose: 'work', country: 'us',
  })
  expect(result).toEqual({ imported: 1, skipped: 1 })
  const rows = await t.query(api.proxies.list, {})
  expect(rows[0]).toMatchObject({ maxProfiles: 3, purpose: 'work', country: 'us',
    proxy: 'http://demo:example@203.0.113.10:5432' })
})

test('manual login proxy import keeps type and country and excludes work profiles', async () => {
  const t = createConvexTest()
  await t.mutation(api.proxies.importMany, {
    text: 'gate.example.com:1080:login:secret', proxyType: 'socks5',
    purpose: 'login', country: 'ro',
  })
  const [login] = await t.query(api.proxies.list, {})
  expect(login).toMatchObject({ purpose: 'login', country: 'ro', proxyType: 'socks5',
    proxy: 'socks5://login:secret@gate.example.com:1080' })
  expect(await t.query(internal.proxies.loginInternal, {})).toMatchObject([{
    _id: login._id, country: 'ro', purpose: 'login',
  }])
  await expect(seedProfile(t, { name: 'Cannot use login proxy', proxy: login.proxy,
    proxyType: login.proxyType })).rejects.toThrow(/Login proxies cannot be assigned/)
})

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

test('login claims and cooldowns protect the endpoint and deletion while allowing metadata edits', async () => {
  const t = createConvexTest()
  const proxy = (await t.mutation(api.proxies.create, {
    name: 'Login', proxy: 'http://old:8080', proxyType: 'http', purpose: 'login', country: 'us',
  }))!
  await t.mutation(internal.igAccounts.importEncryptedInternal, { rows: [
    { usernameHash: 'a'.repeat(64), ciphertext: 'fixture' },
  ] })
  const account = (await t.query(internal.igAccounts.availableInternal, { count: 1 })).page[0]!
  const profile = (await seedProfile(t))!
  await t.mutation(internal.igAccounts.assignInternal, { id: account._id, profileId: profile._id })
  const token = '11111111-1111-4111-8111-111111111111'
  await t.mutation(internal.igAccounts.claimLoginProxyInternal, {
    id: account._id, loginProxyId: proxy._id, proxy: proxy.proxy, token,
  })
  const edit = { id: proxy._id, name: 'Renamed', proxy: proxy.proxy, proxyType: 'http', purpose: 'login' as const, country: 'us' }
  for (const phase of ['claim', 'cooldown']) {
    await t.mutation(api.proxies.update, edit)
    await expect(t.mutation(api.proxies.update, { ...edit, proxy: 'http://new:8080' })).rejects.toThrow('login claim and cooldown')
    await expect(t.mutation(api.proxies.update, { ...edit, purpose: 'work' })).rejects.toThrow('login claim and cooldown')
    await expect(t.mutation(api.proxies.remove, { id: proxy._id })).rejects.toThrow('login claim and cooldown')
    if (phase === 'claim') await t.mutation(internal.igAccounts.recordBrowserLoginInternal, {
      id: account._id, loginProxyId: proxy._id, claimToken: token,
      browserLoggedInAt: Date.now(), cooldownMs: 3 * 86400000,
    })
  }
  await t.run(ctx => ctx.db.patch(proxy._id, { loginCooldownUntil: Date.now() - 1 }))
  await t.mutation(api.proxies.remove, { id: proxy._id })
  expect(await t.query(api.proxies.list, {})).toEqual([])
})

test('a cached login proxy snapshot cannot claim a changed endpoint', async () => {
  const t = createConvexTest()
  const proxy = (await t.mutation(api.proxies.create, {
    name: 'Login', proxy: 'http://old:8080', proxyType: 'http', purpose: 'login', country: 'us',
  }))!
  const id = await t.run(ctx => ctx.db.insert('igAccounts', {
    usernameHash: 'a'.repeat(64), ciphertext: 'fixture', status: 'assigned', createdAt: 1,
  }))
  const updated = (await t.mutation(api.proxies.update, {
    id: proxy._id, name: 'Login', proxy: 'http://new:8080', proxyType: 'http', purpose: 'login', country: 'us',
  }))!
  const claim = { id, loginProxyId: proxy._id, token: '11111111-1111-4111-8111-111111111111' }
  expect(await t.mutation(internal.igAccounts.claimLoginProxyInternal, { ...claim, proxy: proxy.proxy })).toBe(false)
  expect(await t.mutation(internal.igAccounts.claimLoginProxyInternal, { ...claim, proxy: updated.proxy })).toBe(true)
})
