import { afterEach, expect, test, vi } from 'vite-plus/test'
import { createConvexTest, seedProfile } from './helpers'
import { api, internal } from '../../convex/_generated/api'
import type { GenericDatabaseWriter, GenericDataModel } from 'convex/server'

const token = '11111111-1111-4111-8111-111111111111'
const headers = { authorization: 'Bearer test-key', 'content-type': 'application/json' }
afterEach(() => vi.unstubAllEnvs())

async function setup() {
  const t = createConvexTest()
  const profileId = (await seedProfile(t))!._id
  await t.mutation(api.profiles.mutations.setIgState, { profileId, igLoggedIn: true })
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['{}'])))
  await t.mutation(internal.profiles.mutations.saveChatSessionInternal, {
    profileId,
    token,
    storageId,
  })
  return { t, profileId }
}

test('badge counts only enabled counters and follows profile state changes', async () => {
  const { t, profileId } = await setup()
  await t.mutation(internal.chatCache.saveUnreadCount, { profileId, token, unreadCount: 3 })
  expect(await t.query(api.chatCache.unreadCount)).toBe(3)
  await t.mutation(api.profiles.mutations.setIgState, { profileId, igLoggedIn: false })
  expect(await t.query(api.chatCache.unreadCount)).toBe(0)
  await t.mutation(internal.profiles.mutations.setIgStateInternal, { profileId, igLoggedIn: true })
  expect(await t.query(api.chatCache.unreadCount)).toBe(3)
  await t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: 'Profile A' })
  expect(await t.query(api.chatCache.unreadCount)).toBe(0)
})

test('session checkpointing and cookie edits do not modify badge counters', async () => {
  const { t, profileId } = await setup()
  await t.mutation(internal.chatCache.saveUnreadCount, { profileId, token, unreadCount: 2 })
  const counter = await t.run((ctx) => ctx.db.query('chatCounters').unique())
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['refreshed'])))
  await t.mutation(internal.profiles.mutations.saveChatSessionInternal, {
    profileId,
    token,
    storageId,
    expectedToken: token,
  })
  await t.run((ctx) => ctx.db.patch(profileId, { cookiesJson: 'large cookies'.repeat(1000) }))
  const options = await t.query(api.profiles.queries.chatOptions, {})
  expect(options).toEqual([{ _id: profileId, name: 'Profile A', status: 'idle' }])
  await t.mutation(internal.chatCache.saveUnreadCount, { profileId, token, unreadCount: 2 })
  expect(await t.run((ctx) => ctx.db.query('chatCounters').unique())).toEqual(counter)
  expect(await t.query(api.chatCache.unreadCount)).toBe(2)
})

test('replacement sessions and disconnects reject stale counters', async () => {
  const { t, profileId } = await setup()
  await t.mutation(internal.chatCache.saveUnreadCount, { profileId, token, unreadCount: 2 })
  const nextToken = '22222222-2222-4222-8222-222222222222'
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['next'])))
  await t.mutation(internal.profiles.mutations.saveChatSessionInternal, {
    profileId,
    token: nextToken,
    storageId,
  })
  expect(await t.query(api.chatCache.unreadCount)).toBe(0)
  await expect(
    t.mutation(internal.chatCache.saveUnreadCount, { profileId, token, unreadCount: 2 }),
  ).rejects.toThrow('session changed')
  await t.mutation(internal.chatCache.saveUnreadCount, {
    profileId,
    token: nextToken,
    unreadCount: 1,
  })
  await t.mutation(internal.profiles.mutations.deleteChatSessionInternal, { profileId })
  expect(await t.query(api.chatCache.unreadCount)).toBe(0)
  await expect(
    t.mutation(internal.chatCache.saveUnreadCount, { profileId, token: nextToken, unreadCount: 1 }),
  ).rejects.toThrow('session changed')
})

test('count endpoint accepts only bounded counters; retired message endpoint is unavailable', async () => {
  const { t, profileId } = await setup()
  vi.stubEnv('INTERNAL_API_KEY', 'test-key')
  const post = (unreadCount: unknown, sessionToken = token) =>
    t.fetch('/api/chat/count', {
      method: 'POST',
      headers,
      body: JSON.stringify({ profileId, token: sessionToken, unreadCount }),
    })
  expect((await post(4)).status).toBe(200)
  expect(await t.query(api.chatCache.unreadCount)).toBe(4)
  for (const value of [-1, 201, 1.5, null, '4']) expect((await post(value)).status).toBe(400)
  const stale = await post(4, 'stale')
  expect(stale.status).toBe(409)
  expect(await stale.json()).toEqual({ error: 'Chat session changed' })
  expect(await t.query(api.chatCache.unreadCount)).toBe(4)
  await t.mutation(internal.profiles.mutations.deleteChatSessionInternal, { profileId })
  expect((await post(4)).status).toBe(409)
  expect(await t.query(api.chatCache.unreadCount)).toBe(0)
  const invalidProfile = await t.fetch('/api/chat/count', {
    method: 'POST',
    headers,
    body: JSON.stringify({ profileId: 'invalid-id', token, unreadCount: 4 }),
  })
  expect(invalidProfile.status).toBe(500)
  expect((await t.fetch('/api/chat/count', { method: 'POST', body: '{}' })).status).toBe(401)
  expect((await t.fetch('/api/chat/cache', { headers })).status).toBe(404)
})

test('retirement cleanup deletes old cache in bounded batches without touching login sessions', async () => {
  const { t, profileId } = await setup()
  await t.run(async (ctx) => {
    const db = ctx.db as GenericDatabaseWriter<GenericDataModel>
    for (let i = 0; i < 30; i++) {
      await db.insert('chatThreads', { profileId, threadId: String(i), message: 'old cache' })
      await db.insert('chatHistories', { profileId, messages: [] })
    }
  })
  for (const table of ['chatThreads', 'chatHistories'] as const) {
    const first = await t.mutation(internal.chatCache.retireHistory, { table })
    expect(first.deleted).toBe(25)
    expect(first.isDone).toBe(false)
    const second = await t.mutation(internal.chatCache.retireHistory, { table })
    expect(second.deleted).toBe(5)
    expect(second.isDone).toBe(true)
  }
  expect((await t.run((ctx) => ctx.db.query('chatSessions').unique()))?.token).toBe(token)
})
