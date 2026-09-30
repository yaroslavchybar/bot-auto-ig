import { afterEach, expect, test, vi } from 'vite-plus/test'
import { internal } from '../../convex/_generated/api'
import { createConvexTest, seedProfile } from './helpers'

const headers = { authorization: 'Bearer test-key', 'content-type': 'application/json' }
afterEach(() => vi.unstubAllEnvs())

test('saved TypeScript sessions stay connected and only expired or missing sessions need reconnect', async () => {
  const t = createConvexTest()
  const profileId = (await seedProfile(t))!._id
  vi.stubEnv('INTERNAL_API_KEY', 'test-key')
  const id = await t.run((ctx) =>
    ctx.db.insert('igAccounts', {
      usernameHash: 'a'.repeat(64),
      ciphertext: 'encrypted',
      status: 'connected',
      profileId,
      createdAt: 1,
    }),
  )
  const token = '11111111-1111-4111-8111-111111111111'
  const save = (state: string) =>
    t.fetch('/api/chat/session', {
      method: 'POST',
      headers,
      body: JSON.stringify({ profileId, state, token }),
    })
  const account = async () =>
    (await t.query(internal.igAccounts.pageInternal, { cursor: null, count: 50 })).page[0]
  expect((await account()).reconnectRequired).toBe(true)
  expect((await save(JSON.stringify({ cookies: 'old SDK' }))).status).toBe(200)
  expect(
    await t
      .fetch(`/api/chat/session?profileId=${profileId}&status=1`, { headers })
      .then((r) => r.json()),
  ).toEqual({ connected: true, reconnectRequired: false })
  expect((await t.query(internal.igAccounts.byIdInternal, { id }))?.reconnectRequired).toBe(false)
  await t.fetch('/api/chat/session', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      profileId,
      state: JSON.stringify({ cookies: 'old SDK' }),
      token,
      expectedToken: token,
      reconnectRequired: true,
    }),
  })
  expect((await account()).reconnectRequired).toBe(true)
  expect(
    await t
      .fetch(`/api/chat/session?profileId=${profileId}&status=1`, { headers })
      .then((r) => r.json()),
  ).toEqual({ connected: false, reconnectRequired: true })
  expect((await save(JSON.stringify({ version: 1, cookies: [] }))).status).toBe(200)
  expect((await account()).reconnectRequired).toBe(false)
  expect(
    await t
      .fetch(`/api/chat/session?profileId=${profileId}&status=1`, { headers })
      .then((r) => r.json()),
  ).toEqual({ connected: true, reconnectRequired: false })
  await t.fetch(`/api/chat/session?profileId=${profileId}`, { method: 'DELETE', headers })
  expect((await account()).reconnectRequired).toBe(true)
})

test('Chat session is stored as a private file per profile and logout removes it', async () => {
  const t = createConvexTest()
  const first = (await seedProfile(t, { name: 'First' }))!
  const second = (await seedProfile(t, { name: 'Second' }))!
  vi.stubEnv('INTERNAL_API_KEY', 'test-key')
  expect((await t.fetch(`/api/chat/session?profileId=${first._id}`)).status).toBe(401)
  const token = '11111111-1111-4111-8111-111111111111'
  const state = JSON.stringify({ mobile: 'a'.repeat(30_000) })
  const post = (profileId: string, nextState: string, expectedToken?: string) =>
    t.fetch('/api/chat/session', {
      method: 'POST',
      headers,
      body: JSON.stringify({ profileId, state: nextState, token, expectedToken }),
    })
  expect((await post(first._id, state)).status).toBe(200)
  expect((await post(second._id, 'second')).status).toBe(200)
  const firstGet = await t.fetch(`/api/chat/session?profileId=${first._id}`, { headers })
  expect(await firstGet.json()).toEqual({ connected: true, state, token })
  expect(
    (await t.fetch(`/api/chat/session?profileId=${second._id}&status=1`, { headers })).status,
  ).toBe(200)
  expect((await post(first._id, 'updated', token)).status).toBe(200)
  expect(
    (await t.fetch(`/api/chat/session?profileId=${first._id}`, { headers }).then((r) => r.json()))
      .state,
  ).toBe('updated')
  expect(
    (await t.fetch(`/api/chat/session?profileId=${first._id}`, { method: 'DELETE', headers }))
      .status,
  ).toBe(200)
  expect((await post(first._id, 'late write', token)).status).toBe(500)
  expect(
    await t.fetch(`/api/chat/session?profileId=${first._id}`, { headers }).then((r) => r.json()),
  ).toEqual({ connected: false })
  expect(
    await t.fetch(`/api/chat/session?profileId=${second._id}`, { headers }).then((r) => r.json()),
  ).toEqual({ connected: true, state: 'second', token })
  await t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: second.name })
  await t.mutation(internal.profiles.mutations.removeByIdInternal, { profileId: second._id })
  expect(
    await t.fetch(`/api/chat/session?profileId=${second._id}`, { headers }).then((r) => r.json()),
  ).toEqual({ connected: false })
})

test('Repeated session saves keep their file and compare an empty expected token', async () => {
  const t = createConvexTest()
  const profileId = (await seedProfile(t))!._id
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['saved state'])))
  const token = '11111111-1111-4111-8111-111111111111'
  const save = (expectedToken?: string) =>
    t.mutation(internal.profiles.mutations.saveChatSessionInternal, {
      profileId,
      storageId,
      token,
      expectedToken,
    })

  await save()
  await save(token)
  expect(await t.run(async (ctx) => (await ctx.storage.get(storageId))?.text())).toBe('saved state')
  await expect(save('')).rejects.toThrow('Chat session changed')
  expect((await t.run((ctx) => ctx.db.query('chatSessions').unique()))?.token).toBe(token)
  expect(await t.run(async (ctx) => (await ctx.storage.get(storageId))?.text())).toBe('saved state')
})
