import { expect, test, vi } from 'vite-plus/test'
import { api, internal } from '../../convex/_generated/api'
import { createConvexTest, seedList, seedProfile } from './helpers'

test('login retries and setup starts are rounded up, reject invalid times, and allow retry clearing', async () => {
  const t = createConvexTest()
  const list = (await seedList(t, 'Model'))!
  const profile = (await seedProfile(t))!
  await t.mutation(api.profiles.mutations.bulkAddToList, {
    profileIds: [profile._id],
    listId: list._id,
  })
  await t.mutation(internal.igAccounts.importEncryptedInternal, {
    rows: [{ usernameHash: 'f'.repeat(64), ciphertext: 'encrypted' }],
  })
  const account = (await t.query(internal.igAccounts.availableInternal, { count: 1 })).page[0]!
  await t.mutation(internal.igAccounts.assignInternal, { id: account._id, profileId: profile._id })
  const timestamp = Date.now() + 60_000.25
  await t.mutation(internal.igAccounts.setStateInternal, {
    id: account._id,
    status: 'assigned',
    retryAfter: timestamp,
  })
  expect((await t.query(internal.igAccounts.byIdInternal, { id: account._id }))?.retryAfter).toBe(
    Math.ceil(timestamp),
  )
  for (const retryAfter of [-1, Number.MAX_SAFE_INTEGER + 1]) {
    await expect(
      t.mutation(internal.igAccounts.setStateInternal, {
        id: account._id,
        status: 'assigned',
        retryAfter,
      }),
    ).rejects.toThrow('Invalid login retry time')
  }
  await t.mutation(internal.igAccounts.setStateInternal, { id: account._id, status: 'assigned' })
  expect(
    (await t.query(internal.igAccounts.byIdInternal, { id: account._id }))?.retryAfter,
  ).toBeUndefined()
  for (const startedAt of [0, -1, Number.MAX_SAFE_INTEGER + 1]) {
    await expect(
      t.mutation(internal.igAccounts.modelSetupEnrollInternal, {
        profileId: profile._id,
        modelId: list._id,
        startedAt,
      }),
    ).rejects.toThrow('Invalid setup start time')
  }
  await t.mutation(internal.igAccounts.modelSetupEnrollInternal, {
    profileId: profile._id,
    modelId: list._id,
    startedAt: timestamp,
  })
  expect((await t.query(internal.igAccounts.modelSetupListInternal, {}))[0].startedAt).toBe(
    Math.ceil(timestamp),
  )
})

test('encrypted IG credentials are deduplicated, assigned, and released with the profile', async () => {
  const t = createConvexTest()
  const encrypted = { usernameHash: 'a'.repeat(64), ciphertext: 'v1.encrypted-only' }
  expect(await t.mutation(internal.igAccounts.importEncryptedInternal,
    { rows: [encrypted, encrypted] })).toEqual({ imported: 1, skipped: 1 })
  const account = (await t.query(internal.igAccounts.availableInternal, { count: 1 })).page[0]!
  expect(account.ciphertext).toBe(encrypted.ciphertext)
  expect(JSON.stringify(account)).not.toContain('private-password')

  const profile = await seedProfile(t, { name: 'IG profile' })
  await t.mutation(internal.igAccounts.assignInternal, { id: account._id, profileId: profile!._id })
  expect((await t.query(internal.igAccounts.byProfileInternal, { profileId: profile!._id }))?._id)
    .toBe(account._id)
  expect((await t.query(internal.profiles.queries.getByIdInternal, { profileId: profile!._id }))?.igAccountId)
    .toBe(account._id)

  const other = await seedProfile(t, { name: 'Other profile' })
  await expect(t.mutation(internal.igAccounts.assignInternal,
    { id: account._id, profileId: other!._id })).rejects.toThrow(/not available/)
  await expect(t.mutation(internal.igAccounts.setStateInternal,
    { id: account._id, status: 'available' })).rejects.toThrow(/Release the profile/)
  expect((await t.query(internal.igAccounts.byIdInternal, { id: account._id }))?.status)
    .toBe('assigned')
  expect((await t.query(internal.profiles.queries.getByIdInternal,
    { profileId: profile!._id }))?.igAccountId).toBe(account._id)
  await t.mutation(internal.igAccounts.setStateInternal, { id: account._id, status: 'connected' })
  await t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: 'IG profile' })
  await t.mutation(internal.profiles.mutations.removeByIdInternal, { profileId: profile!._id })
  expect((await t.query(internal.igAccounts.availableInternal, { count: 1 })).page[0]?._id).toBe(account._id)
})

test('allocation can scan past unreadable available credentials', async () => {
  const t = createConvexTest()
  await t.mutation(internal.igAccounts.importEncryptedInternal, { rows: [
    { usernameHash: 'c'.repeat(64), ciphertext: 'v1.corrupt' },
    { usernameHash: 'd'.repeat(64), ciphertext: 'v1.valid' },
  ] })
  const first = await t.query(internal.igAccounts.availableInternal, { count: 1 })
  expect(first.page).toHaveLength(1)
  expect((await t.query(internal.igAccounts.availableInternal,
    { count: 1, cursor: first.continueCursor })).page).toHaveLength(1)
})

test('model setup in Convex resets outreach on moves and opens it after nine posts', async () => {
  const t = createConvexTest()
  const first = (await seedList(t, 'First model'))!
  const second = (await seedList(t, 'Second model'))!
  const profile = (await seedProfile(t, { name: 'model profile' }))!
  await t.mutation(api.profiles.mutations.bulkAddToList,
    { profileIds: [profile._id], listId: first._id })
  await t.mutation(internal.igAccounts.modelSetupEnrollInternal,
    { profileId: profile._id, modelId: first._id, startedAt: 1 })
  for (const postSourceIds of ['123456789', Array.from({ length: 9 }, (_, i) => i)]) {
    await expect(t.mutation(internal.igAccounts.modelSetupPatchInternal,
      { profileId: profile._id, modelId: first._id, patch: { postSourceIds }, clear: [] }))
      .rejects.toThrow('Invalid model setup update')
  }
  await expect(t.mutation(internal.igAccounts.modelSetupPatchInternal,
    { profileId: profile._id, modelId: first._id, patch: { postDates: ['2026-09-27', 1] }, clear: [] }))
    .rejects.toThrow('Invalid model setup update')
  expect((await t.query(internal.profiles.queries.getByIdInternal,
    { profileId: profile._id }))?.outreachReady).toBe(false)
  await t.mutation(internal.igAccounts.modelSetupPatchInternal, {
    profileId: profile._id, modelId: first._id, patch: { postSourceIds: Array.from({ length: 9 }, (_, i) => `post-${i}`) }, clear: [],
  })
  expect((await t.query(internal.profiles.queries.getByIdInternal,
    { profileId: profile._id }))?.outreachReady).toBe(false)
  expect((await t.query(internal.igAccounts.modelSetupListInternal, {}))[0]?.outreachReadyMarked)
    .toBeUndefined()
  await expect(t.mutation(internal.igAccounts.modelSetupPatchInternal,
    { profileId: profile._id, modelId: first._id, patch: { outreachReadyMarked: true }, clear: [] }))
    .rejects.toThrow('9 recorded posts')
  await t.mutation(internal.igAccounts.modelSetupPatchInternal, { profileId: profile._id, modelId: first._id,
    patch: { postDates: Array.from({ length: 9 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`) },
    clear: [] })
  expect((await t.query(internal.profiles.queries.getByIdInternal,
    { profileId: profile._id }))?.outreachReady).toBe(true)

  await t.mutation(api.profiles.mutations.bulkAddToList,
    { profileIds: [profile._id], listId: second._id })
  expect((await t.query(internal.profiles.queries.getByIdInternal,
    { profileId: profile._id }))?.outreachReady).toBe(false)
  await expect(t.mutation(internal.igAccounts.modelSetupPatchInternal,
    { profileId: profile._id, modelId: first._id, patch: { outreachReadyMarked: true }, clear: [] }))
    .rejects.toThrow('moved to another model')

  await t.mutation(internal.igAccounts.modelSetupEnrollInternal,
    { profileId: profile._id, modelId: second._id, startedAt: 2 })
  const state = (await t.query(internal.igAccounts.modelSetupListInternal, {}))[0]!
  expect(state).toMatchObject({ modelId: second._id, postSourceIds: [], startedAt: 2 })
  expect((await t.query(internal.profiles.queries.getByIdInternal,
    { profileId: profile._id }))?.outreachReady).toBe(false)
  await t.mutation(internal.igAccounts.modelSetupPatchInternal, { profileId: profile._id, modelId: second._id,
    patch: { targetUsername: 'legacy_name', pending: { kind: 'name', date: '2026-09-27' } },
    clear: [] })
  await t.mutation(internal.igAccounts.modelSetupReconcileInternal,
    { profileId: profile._id, resolution: 'completed' })
  expect((await t.query(internal.igAccounts.modelSetupListInternal, {}))[0])
    .toMatchObject({ nameDone: true, targetUsername: 'legacy_name', postSourceIds: [] })
  expect((await t.query(internal.igAccounts.modelSetupListInternal, {}))[0]?.pending).toBeUndefined()
  await t.mutation(internal.igAccounts.modelSetupPatchInternal, { profileId: profile._id, modelId: second._id,
    patch: { targetUsername: 'new_name', pending: { kind: 'username', date: '2026-09-27' } },
    clear: [] })
  await t.mutation(internal.igAccounts.modelSetupReconcileInternal,
    { profileId: profile._id, resolution: 'completed' })
  expect((await t.query(internal.igAccounts.modelSetupListInternal, {}))[0])
    .toMatchObject({ nameDone: true, targetUsername: 'new_name' })
  expect((await t.query(internal.igAccounts.modelSetupListInternal, {}))[0]?.fullNameDone)
    .toBeUndefined()
  await t.mutation(internal.igAccounts.modelSetupPatchInternal, { profileId: profile._id, modelId: second._id,
    patch: { fullName: 'New Name', pending: { kind: 'fullName', date: '2026-09-27' } }, clear: [] })
  await t.mutation(internal.igAccounts.modelSetupReconcileInternal,
    { profileId: profile._id, resolution: 'completed' })
  expect((await t.query(internal.igAccounts.modelSetupListInternal, {}))[0])
    .toMatchObject({ nameDone: true, fullNameDone: true, fullName: 'New Name' })
  await t.mutation(internal.igAccounts.modelSetupPatchInternal,
    { profileId: profile._id, modelId: second._id, patch: { pending: { kind: 'avatar', date: '2026-09-27' } }, clear: [] })
  await t.mutation(internal.igAccounts.modelSetupReconcileInternal,
    { profileId: profile._id, resolution: 'failed' })
  expect((await t.query(internal.igAccounts.modelSetupListInternal, {}))[0]?.pending).toBeUndefined()
  await t.mutation(internal.igAccounts.modelSetupPatchInternal,
    { profileId: profile._id, modelId: second._id, patch: { pending: { kind: 'avatar', date: '2026-09-27' } }, clear: [] })
  await t.mutation(internal.igAccounts.modelSetupReconcileInternal,
    { profileId: profile._id, resolution: 'completed' })
  expect((await t.query(internal.igAccounts.modelSetupListInternal, {}))[0]?.avatarDone).toBe(true)
  await expect(t.mutation(internal.igAccounts.modelSetupReconcileInternal,
    { profileId: profile._id, resolution: 'completed' })).rejects.toThrow('No active model setup action')

  await t.mutation(internal.igAccounts.modelSetupPatchInternal, { profileId: profile._id, modelId: second._id,
    patch: { postSourceIds: Array.from({ length: 8 }, (_, i) => `source-${i}`),
      postDates: Array.from({ length: 8 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`),
      pending: { kind: 'post', sourceId: 'source-8', date: '2026-09-27' } }, clear: [] })
  await t.mutation(internal.igAccounts.modelSetupReconcileInternal,
    { profileId: profile._id, resolution: 'completed' })
  expect((await t.query(internal.igAccounts.modelSetupListInternal, {}))[0]?.postSourceIds).toHaveLength(9)
  expect((await t.query(internal.profiles.queries.getByIdInternal,
    { profileId: profile._id }))?.outreachReady).toBe(true)
})

test.each(['post', 'avatar', 'username'] as const)('pending %s prevents model changes until resolved', async kind => {
  const t = createConvexTest()
  const first = (await seedList(t, 'First'))!
  const second = (await seedList(t, 'Second'))!
  const profile = (await seedProfile(t))!
  await t.mutation(api.profiles.mutations.bulkAddToList, { profileIds: [profile._id], listId: first._id })
  await t.mutation(internal.igAccounts.modelSetupEnrollInternal, { profileId: profile._id, modelId: first._id, startedAt: 1 })
  await t.mutation(internal.igAccounts.modelSetupPatchInternal, {
    profileId: profile._id, modelId: first._id, patch: { pending: { kind, date: '2026-10-10' } }, clear: [],
  })
  await expect(t.mutation(api.profiles.mutations.bulkAddToList, { profileIds: [profile._id], listId: second._id }))
    .rejects.toThrow('pending model setup action')
  await expect(t.mutation(api.profiles.mutations.bulkRemoveFromList, { profileIds: [profile._id], listId: first._id }))
    .rejects.toThrow('pending model setup action')
  await expect(t.mutation(internal.profiles.mutations.bulkSetListIdInternal, { profileIds: [profile._id], listId: second._id }))
    .rejects.toThrow('pending model setup action')
  await expect(t.mutation(api.lists.remove, { id: first._id })).rejects.toThrow('pending model setup actions')
  await t.run(ctx => ctx.db.patch(profile._id, { listIds: [second._id] }))
  await expect(t.mutation(internal.igAccounts.modelSetupEnrollInternal, { profileId: profile._id, modelId: second._id, startedAt: 1 }))
    .rejects.toThrow('pending model setup action')
  expect((await t.query(internal.igAccounts.modelSetupListInternal, {}))[0]?.pending?.kind).toBe(kind)
  await t.run(ctx => ctx.db.patch(profile._id, { listIds: [first._id] }))
  await t.mutation(internal.igAccounts.modelSetupReconcileInternal, { profileId: profile._id, resolution: 'failed' })
  await t.mutation(api.profiles.mutations.bulkAddToList, { profileIds: [profile._id], listId: second._id })
  await t.mutation(internal.igAccounts.modelSetupEnrollInternal, { profileId: profile._id, modelId: second._id, startedAt: 1 })
  await expect(t.mutation(internal.igAccounts.modelSetupPatchInternal, {
    profileId: profile._id, modelId: first._id, patch: { pending: { kind, date: '2026-10-10' } }, clear: [],
  })).rejects.toThrow('moved to another model')
  expect((await t.query(internal.igAccounts.modelSetupListInternal, {}))[0]?.pending).toBeUndefined()
})

test('browser login records success and waits for model setup to connect mobile', async () => {
  vi.stubEnv('INTERNAL_API_KEY', 'test-bridge')
  const t = createConvexTest()
  const loginProxy = (await t.mutation(api.proxies.create, {
    name: 'Login proxy', proxy: 'http://user:pass@host:8080', proxyType: 'http',
    purpose: 'login', country: 'us',
  }))!
  await t.mutation(internal.igAccounts.importEncryptedInternal, {
    rows: [{ usernameHash: 'b'.repeat(64), ciphertext: 'encrypted' }],
  })
  const account = (await t.query(internal.igAccounts.availableInternal, { count: 1 })).page[0]!
  const profile = (await seedProfile(t, { name: 'scheduled' }))!
  await t.mutation(internal.igAccounts.assignInternal, { id: account._id, profileId: profile._id })
  await expect(t.query(api.igAccounts.loginWork, { bridgeToken: 'wrong' }))
    .rejects.toThrow('Unauthorized')
  expect(await t.query(api.igAccounts.loginWork, { bridgeToken: 'test-bridge' }))
    .toEqual([{ profileId: profile._id, retryAfter: 0 }])
  const browserLoggedInAt = Date.now()
  const cooldownMs = 4 * 24 * 60 * 60_000
  const claimToken = '11111111-1111-4111-8111-111111111111'
  await expect(t.mutation(internal.igAccounts.recordBrowserLoginInternal, {
    id: account._id, browserLoggedInAt: -1,
    loginProxyId: loginProxy._id, claimToken, cooldownMs,
  })).rejects.toThrow('Invalid browser login time')
  expect(await t.mutation(internal.igAccounts.claimLoginProxyInternal,
    { id: account._id, loginProxyId: loginProxy._id, proxy: loginProxy.proxy, token: claimToken })).toBe(true)
  expect(await t.mutation(internal.igAccounts.recordBrowserLoginInternal, {
    id: account._id, browserLoggedInAt,
    loginProxyId: loginProxy._id, claimToken, cooldownMs,
  })).toEqual({ cooldownRecorded: true })
  expect((await t.query(internal.igAccounts.byIdInternal, { id: account._id }))?.browserLoggedInAt)
    .toBe(browserLoggedInAt)
  const savedProxy = (await t.query(api.proxies.list, {}))[0]!
  expect(savedProxy.loginCooldownUntil).toBeGreaterThanOrEqual(browserLoggedInAt + cooldownMs)
  expect(savedProxy.loginCooldownAccountId).toBe(account._id)
  expect(savedProxy.loginClaim).toBeUndefined()
  await t.mutation(internal.igAccounts.assignInternal, { id: account._id, profileId: profile._id })
  expect((await t.query(internal.profiles.queries.getByIdInternal, { profileId: profile._id }))?.igLoggedIn).toBe(true)
  expect(await t.query(api.igAccounts.loginWork, { bridgeToken: 'test-bridge' })).toEqual([])
  await t.mutation(internal.igAccounts.recordBrowserLoginInternal, {
    id: account._id, browserLoggedInAt: browserLoggedInAt + 60_000,
    loginProxyId: loginProxy._id, claimToken, cooldownMs,
  })
  expect((await t.query(internal.igAccounts.byIdInternal, { id: account._id }))?.browserLoggedInAt).toBe(browserLoggedInAt)
  await t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: 'scheduled' })
  await t.mutation(internal.profiles.mutations.removeByIdInternal, { profileId: profile._id })
  expect((await t.query(internal.igAccounts.byIdInternal, { id: account._id }))?.browserLoggedInAt).toBeUndefined()
  vi.unstubAllEnvs()
})

test('a Login proxy claim blocks another account before login and cooldown blocks reuse', async () => {
  const t = createConvexTest()
  const proxy = (await t.mutation(api.proxies.create, {
    name: 'Login proxy', proxy: 'http://user:pass@host:8080', proxyType: 'http',
    purpose: 'login', country: 'us',
  }))!
  await t.mutation(internal.igAccounts.importEncryptedInternal, { rows: [
    { usernameHash: 'e'.repeat(64), ciphertext: 'encrypted-one' },
    { usernameHash: 'f'.repeat(64), ciphertext: 'encrypted-two' },
  ] })
  const [first, second] = (await t.query(internal.igAccounts.availableInternal, { count: 2 })).page
  const firstProfile = (await seedProfile(t, { name: 'first' }))!
  const secondProfile = (await seedProfile(t, { name: 'second' }))!
  await t.mutation(internal.igAccounts.assignInternal, { id: first!._id, profileId: firstProfile._id })
  await t.mutation(internal.igAccounts.assignInternal, { id: second!._id, profileId: secondProfile._id })
  const firstToken = '11111111-1111-4111-8111-111111111111'
  const secondToken = '22222222-2222-4222-8222-222222222222'
  expect(await t.mutation(internal.igAccounts.claimLoginProxyInternal,
    { id: first!._id, loginProxyId: proxy._id, proxy: proxy.proxy, token: firstToken })).toBe(true)
  expect(await t.mutation(internal.igAccounts.claimLoginProxyInternal,
    { id: second!._id, loginProxyId: proxy._id, proxy: proxy.proxy, token: secondToken })).toBe(false)
  await t.mutation(internal.igAccounts.releaseLoginProxyInternal,
    { id: first!._id, loginProxyId: proxy._id, token: secondToken })
  expect(await t.mutation(internal.igAccounts.claimLoginProxyInternal,
    { id: second!._id, loginProxyId: proxy._id, proxy: proxy.proxy, token: secondToken })).toBe(false)
  expect(await t.mutation(internal.igAccounts.recordBrowserLoginInternal, {
    id: first!._id, loginProxyId: proxy._id, claimToken: firstToken,
    browserLoggedInAt: Date.now(), cooldownMs: 3 * 24 * 60 * 60_000,
  })).toEqual({ cooldownRecorded: true })
  expect(await t.mutation(internal.igAccounts.claimLoginProxyInternal,
    { id: second!._id, loginProxyId: proxy._id, proxy: proxy.proxy, token: secondToken })).toBe(false)
  expect((await t.query(internal.igAccounts.byIdInternal, { id: second!._id }))?.browserLoggedInAt)
    .toBeUndefined()
})

test('a lost claim does not erase a confirmed browser login', async () => {
  const t = createConvexTest()
  const proxy = (await t.mutation(api.proxies.create, {
    name: 'Login proxy', proxy: 'http://user:pass@host:8080', proxyType: 'http',
    purpose: 'login', country: 'us',
  }))!
  await t.mutation(internal.igAccounts.importEncryptedInternal, { rows: [
    { usernameHash: '1'.repeat(64), ciphertext: 'encrypted-one' },
    { usernameHash: '2'.repeat(64), ciphertext: 'encrypted-two' },
  ] })
  const [first, second] = (await t.query(internal.igAccounts.availableInternal, { count: 2 })).page
  const profile = (await seedProfile(t, { name: 'browser-success' }))!
  const other = (await seedProfile(t, { name: 'other' }))!
  await t.mutation(internal.igAccounts.assignInternal, { id: first!._id, profileId: profile._id })
  await t.mutation(internal.igAccounts.assignInternal, { id: second!._id, profileId: other._id })
  const firstToken = '11111111-1111-4111-8111-111111111111'
  const secondToken = '22222222-2222-4222-8222-222222222222'
  await t.mutation(internal.igAccounts.claimLoginProxyInternal,
    { id: first!._id, loginProxyId: proxy._id, proxy: proxy.proxy, token: firstToken })
  await t.mutation(internal.igAccounts.releaseLoginProxyInternal,
    { id: first!._id, loginProxyId: proxy._id, token: firstToken })
  await t.mutation(internal.igAccounts.claimLoginProxyInternal,
    { id: second!._id, loginProxyId: proxy._id, proxy: proxy.proxy, token: secondToken })
  await t.mutation(internal.igAccounts.releaseLoginProxyInternal,
    { id: first!._id, loginProxyId: proxy._id, token: firstToken })
  const browserLoggedInAt = Date.now()
  expect(await t.mutation(internal.igAccounts.recordBrowserLoginInternal, {
    id: first!._id, loginProxyId: proxy._id, claimToken: firstToken,
    browserLoggedInAt,
    cooldownMs: 4 * 24 * 60 * 60_000,
  })).toEqual({ cooldownRecorded: false })
  expect((await t.query(internal.profiles.queries.getByIdInternal,
    { profileId: profile._id }))?.igLoggedIn).toBe(true)
  expect((await t.query(internal.igAccounts.byIdInternal,
    { id: first!._id }))?.browserLoggedInAt).toBe(browserLoggedInAt)
  expect((await t.query(api.proxies.list, {}))[0]?.loginClaim?.accountId).toBe(second!._id)
})
