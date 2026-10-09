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
  await t.mutation(internal.chatCache.saveUnreadCount, {
    profileId,
    token,
    unreadThreadIds: ['1', '2', '3'],
  })
  expect(await t.query(api.chatCache.unreadCount)).toBe(3)
  await t.mutation(api.profiles.mutations.setIgState, { profileId, igLoggedIn: false })
  expect(await t.query(api.chatCache.unreadCount)).toBe(0)
  await t.mutation(internal.profiles.mutations.setIgStateInternal, { profileId, igLoggedIn: true })
  expect(await t.query(api.chatCache.unreadCount)).toBe(3)
  await t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: 'Profile A' })
  expect(await t.query(api.chatCache.unreadCount)).toBe(0)
})

test('archiving excludes only unread chats in that profile and restoring immediately counts them again', async () => {
  const { t, profileId } = await setup()
  const second = (await seedProfile(t, { name: 'Second' }))!._id
  await t.mutation(api.profiles.mutations.setIgState, { profileId: second, igLoggedIn: true })
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['{}'])))
  await t.mutation(internal.profiles.mutations.saveChatSessionInternal, {
    profileId: second,
    token,
    storageId,
  })
  await t.mutation(internal.chatCache.saveUnreadCount, {
    profileId,
    token,
    unreadThreadIds: ['1', '2'],
  })
  await t.mutation(internal.chatCache.saveUnreadCount, {
    profileId: second,
    token,
    unreadThreadIds: ['1'],
  })
  expect(await t.query(api.chatCache.unreadCount)).toBe(3)
  const archive = (threadId: string, archived: boolean) =>
    t.mutation(internal.chatArchives.setArchived, { profileId, threadId, archived })
  await archive('1', true)
  expect(await t.query(api.chatCache.unreadCount)).toBe(2)
  await archive('3', true) // A read chat does not lower the badge.
  expect(await t.query(api.chatCache.unreadCount)).toBe(2)
  // New incoming messages in archived chats stay out of the badge.
  await t.mutation(internal.chatCache.saveUnreadCount, {
    profileId,
    token,
    unreadThreadIds: ['1', '2', '3'],
  })
  expect(await t.query(api.chatCache.unreadCount)).toBe(2)
  await archive('1', false)
  expect(await t.query(api.chatCache.unreadCount)).toBe(3)
  await archive('3', false)
  expect(await t.query(api.chatCache.unreadCount)).toBe(4)
  // Replying to a chat while archived means restoring it adds nothing.
  await archive('1', true)
  await t.mutation(internal.chatCache.saveUnreadCount, {
    profileId,
    token,
    unreadThreadIds: ['2', '3'],
  })
  await archive('1', false)
  expect(await t.query(api.chatCache.unreadCount)).toBe(3)
})

test('equal totals with different unread chats update the archive-aware summary; ordering does not write', async () => {
  const { t, profileId } = await setup()
  await t.mutation(internal.chatArchives.setArchived, { profileId, threadId: '1', archived: true })
  await t.mutation(internal.chatCache.saveUnreadCount, {
    profileId,
    token,
    unreadThreadIds: ['1', '2'],
  })
  expect(await t.query(api.chatCache.unreadCount)).toBe(1)
  await t.mutation(internal.chatCache.saveUnreadCount, {
    profileId,
    token,
    unreadThreadIds: ['2', '3'],
  })
  expect(await t.query(api.chatCache.unreadCount)).toBe(2)
  const row = await t.run((ctx) => ctx.db.query('chatCounters').unique())
  await t.mutation(internal.chatCache.saveUnreadCount, {
    profileId,
    token,
    unreadThreadIds: ['3', '2'],
  })
  expect(await t.run((ctx) => ctx.db.query('chatCounters').unique())).toEqual(row)
})

test('session checkpointing and cookie edits do not modify badge counters', async () => {
  const { t, profileId } = await setup()
  await t.mutation(internal.chatCache.saveUnreadCount, {
    profileId,
    token,
    unreadThreadIds: ['1', '2'],
  })
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
  await t.mutation(internal.chatCache.saveUnreadCount, {
    profileId,
    token,
    unreadThreadIds: ['1', '2'],
  })
  expect(await t.run((ctx) => ctx.db.query('chatCounters').unique())).toEqual(counter)
  expect(await t.query(api.chatCache.unreadCount)).toBe(2)
})

test('replacement sessions and disconnects reject stale counters', async () => {
  const { t, profileId } = await setup()
  await t.mutation(internal.chatCache.saveUnreadCount, {
    profileId,
    token,
    unreadThreadIds: ['1', '2'],
  })
  const nextToken = '22222222-2222-4222-8222-222222222222'
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['next'])))
  await t.mutation(internal.profiles.mutations.saveChatSessionInternal, {
    profileId,
    token: nextToken,
    storageId,
  })
  expect(await t.query(api.chatCache.unreadCount)).toBe(0)
  await expect(
    t.mutation(internal.chatCache.saveUnreadCount, {
      profileId,
      token,
      unreadThreadIds: ['1', '2'],
    }),
  ).rejects.toThrow('session changed')
  await t.mutation(internal.chatCache.saveUnreadCount, {
    profileId,
    token: nextToken,
    unreadThreadIds: ['1'],
  })
  await t.mutation(internal.profiles.mutations.deleteChatSessionInternal, { profileId })
  expect(await t.query(api.chatCache.unreadCount)).toBe(0)
  await expect(
    t.mutation(internal.chatCache.saveUnreadCount, {
      profileId,
      token: nextToken,
      unreadThreadIds: ['1'],
    }),
  ).rejects.toThrow('session changed')
})

test('count endpoint accepts only bounded conversation summaries; retired message endpoint is unavailable', async () => {
  const { t, profileId } = await setup()
  vi.stubEnv('INTERNAL_API_KEY', 'test-key')
  const post = (unreadThreadIds: unknown, sessionToken = token) =>
    t.fetch('/api/chat/count', {
      method: 'POST',
      headers,
      body: JSON.stringify({ profileId, token: sessionToken, unreadThreadIds }),
    })
  expect((await post(['1', '2', '3', '4'])).status).toBe(200)
  expect(await t.query(api.chatCache.unreadCount)).toBe(4)
  for (const value of [
    null,
    '4',
    [1],
    ['bad'],
    ['1', '1'],
    ['1'.repeat(41)],
    Array.from({ length: 201 }, (_, i) => String(i)),
  ])
    expect((await post(value)).status).toBe(400)
  const stale = await post(['1', '2', '3', '4'], 'stale')
  expect(stale.status).toBe(409)
  expect(await stale.json()).toEqual({ error: 'Chat session changed' })
  expect(await t.query(api.chatCache.unreadCount)).toBe(4)
  await t.mutation(internal.profiles.mutations.deleteChatSessionInternal, { profileId })
  expect((await post(['1', '2', '3', '4'])).status).toBe(409)
  expect(await t.query(api.chatCache.unreadCount)).toBe(0)
  const invalidProfile = await t.fetch('/api/chat/count', {
    method: 'POST',
    headers,
    body: JSON.stringify({ profileId: 'invalid-id', token, unreadThreadIds: ['1', '2', '3', '4'] }),
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
