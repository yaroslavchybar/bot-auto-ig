import { afterEach, expect, test, vi } from 'vitest'
import { createConvexTest, seedProfile } from './helpers'
import { api, internal } from '../../convex/_generated/api'

const headers = { authorization: 'Bearer test-key', 'content-type': 'application/json' }
const token = '11111111-1111-4111-8111-111111111111'
afterEach(() => vi.unstubAllEnvs())

test('Unread conversations stay unread until a reply, including across reads and stale syncs', async () => {
  const t = createConvexTest()
  const profileId = (await seedProfile(t))!._id
  await t.mutation(api.profiles.mutations.setIgState, { profileId, igLoggedIn: true })
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(['{}'])))
  await t.mutation(internal.profiles.mutations.saveChatSessionInternal, { profileId, token, storageId })
  const message = (timestamp: number, senderId = 'friend') =>
    ({ id: String(timestamp), timestamp, senderId, text: 'Hello', kind: 'text' })
  const thread = { id: '123', title: 'Friend', users: [], messages: [message(100)], lastSeenAt: [] }
  const save = (value = thread) => t.mutation(internal.chatCache.saveInbox, {
    profileId, token, viewerId: 'viewer', threads: [value],
  })
  await save()
  await save()
  expect(await t.query(api.chatCache.unreadCount)).toBe(1)
  expect((await t.query(internal.chatCache.conversation, { profileId, threadId: thread.id }))?.unread).toBe(true)
  await t.mutation(internal.chatCache.saveConversation, { profileId, token,
    thread: { ...thread, lastSeenAt: [{ userId: 'viewer', timestamp: 200 }] } })
  expect(await t.query(api.chatCache.unreadCount)).toBe(1)
  // Falling out of the latest inbox snapshot must not dismiss an unanswered conversation.
  await t.mutation(internal.chatCache.saveInbox, { profileId, token, viewerId: 'viewer', threads: [] })
  expect(await t.query(api.chatCache.unreadCount)).toBe(1)
  const reply = (throughAt: number) => t.mutation(internal.chatCache.markReplied, {
    profileId, token, threadId: thread.id, throughAt,
  })
  await reply(200)
  await reply(200)
  await save()
  expect(await t.query(api.chatCache.unreadCount)).toBe(0)
  // A newer incoming message that raced with a reply must remain unread.
  await save({ ...thread, messages: [message(300)] })
  await reply(250)
  expect(await t.query(api.chatCache.unreadCount)).toBe(1)
  // A reply from another Instagram client clears unread without markReplied.
  await save({ ...thread, messages: [message(320, 'viewer')] })
  expect(await t.query(api.chatCache.unreadCount)).toBe(0)
  await save({ ...thread, messages: [message(330)] })
  expect(await t.query(api.chatCache.unreadCount)).toBe(1)
  await reply(350)
  await save({ ...thread, messages: [message(360, 'viewer')] })
  expect(await t.query(api.chatCache.unreadCount)).toBe(0)
  // Persist a newer reply watermark even when the preview and unread flag match.
  await t.run(async ctx => {
    const row = await ctx.db.query('chatThreads').withIndex('by_profile_session_thread', q =>
      q.eq('profileId', profileId).eq('sessionToken', token).eq('threadId', thread.id)).unique()
    if (!row) throw new Error('Missing Chat thread')
    await ctx.db.patch(row._id, { repliedThroughAt: 350 })
  })
  await save({ ...thread, messages: [message(360, 'viewer')] })
  await save({ ...thread, messages: [message(355)] })
  expect(await t.query(api.chatCache.unreadCount)).toBe(0)
  await save({ ...thread, messages: [message(400)] })
  expect(await t.query(api.chatCache.unreadCount)).toBe(1)
  await save({ ...thread, id: 'answered', messages: [message(500, 'viewer')] })
  await t.mutation(internal.chatCache.saveConversation, { profileId, token,
    thread: { ...thread, id: 'answered', messages: [message(500, 'viewer'), message(450)] } })
  expect(await t.query(api.chatCache.unreadCount)).toBe(1)
  await t.mutation(api.profiles.mutations.setIgState, { profileId, igLoggedIn: false })
  expect(await t.query(api.chatCache.unreadCount)).toBe(0)
  await t.mutation(api.profiles.mutations.setIgState, { profileId, igLoggedIn: true })
  expect(await t.query(api.chatCache.unreadCount)).toBe(1)
  await t.mutation(internal.profiles.mutations.deleteChatSessionInternal, { profileId })
  expect(await t.query(api.chatCache.unreadCount)).toBe(0)
})

test('Chat cache keeps messages across inbox syncs and resets with the session', async () => {
  const t = createConvexTest()
  const profile = (await seedProfile(t, { name: 'Cached' }))!
  vi.stubEnv('INTERNAL_API_KEY', 'test-key')
  const url = `/api/chat/cache?profileId=${profile._id}`
  const post = (body: object) => t.fetch('/api/chat/cache', {
    method: 'POST', headers, body: JSON.stringify({ profileId: profile._id, token, ...body }),
  })
  const session = (sessionToken: string) => t.fetch('/api/chat/session', {
    method: 'POST', headers, body: JSON.stringify({ profileId: profile._id,
      state: '{}', token: sessionToken }),
  })
  const message = (id: string, timestamp: number) =>
    ({ id, senderId: 'viewer', text: id, timestamp, kind: 'text' })
  const shell = { id: '123', title: 'Friend', users: [{ id: 'friend', username: 'friend' }],
    lastSeenAt: [{ userId: 'friend', timestamp: 2000 }] }

  expect((await session(token)).status).toBe(200)
  expect((await post({ scope: 'inbox', viewerId: 'viewer', threads: [
    { ...shell, messages: [{ ...message('new', 2000), clientContext: 'send-token' }] },
  ] })).status).toBe(200)
  expect((await post({ scope: 'thread', thread: {
    ...shell, messages: [{ ...message('new', 2000), clientContext: 'send-token' }, message('old', 1000)],
  } })).status).toBe(200)
  const conversationUrl = `${url}&threadId=123`
  expect((await t.fetch(conversationUrl, { headers }).then(r => r.json())).messages.map((m: { id: string }) => m.id))
    .toEqual(['new', 'old'])
  expect((await t.fetch(conversationUrl, { headers }).then(r => r.json())).messages[0].clientContext)
    .toBe('send-token')
  expect((await post({ scope: 'inbox', viewerId: 'viewer', threads: [
    { ...shell, lastSeenAt: [{ userId: 'friend', timestamp: 1500 }],
      messages: [message('newer', 3000)] },
  ] })).status).toBe(200)
  const conversation = await t.fetch(conversationUrl, { headers }).then(r => r.json())
  expect(conversation.messages.map((m: { id: string }) => m.id)).toEqual(['newer', 'new', 'old'])
  expect(conversation.lastSeenAt).toEqual(shell.lastSeenAt)
  const history = await t.run(ctx => ctx.db.query('chatHistories').unique())
  expect(history?.messages.map(item => item.id)).toEqual(['new', 'old'])
  expect(await t.run(ctx => ctx.db.query('chatThreads').unique())).not.toHaveProperty('messages')
  expect((await t.fetch(url, { headers }).then(r => r.json())).threads[0].messages.map((m: { id: string }) => m.id))
    .toEqual(['newer'])

  expect((await post({ scope: 'thread', thread: {
    ...shell, messages: [message('newer', 3000), message('old', 1000)],
  } })).status).toBe(200)
  expect((await t.fetch(conversationUrl, { headers }).then(r => r.json())).messages.map((m: { id: string }) => m.id))
    .toEqual(['newer', 'old'])
  expect((await post({ scope: 'inbox', viewerId: 'viewer', threads: [] })).status).toBe(200)
  expect((await t.fetch(url, { headers }).then(r => r.json())).threads).toEqual([])

  const replacement = '22222222-2222-4222-8222-222222222222'
  expect((await session(replacement)).status).toBe(200)
  expect((await t.fetch(url, { headers }).then(r => r.json())).threads).toEqual([])
  expect(await t.fetch(conversationUrl, { headers }).then(r => r.json())).toBeNull()
})

test('Unread inbox updates keep previously cached read conversations', async () => {
  const t = createConvexTest()
  const profileId = (await seedProfile(t))!._id
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(['{}'])))
  await t.mutation(internal.profiles.mutations.saveChatSessionInternal, { profileId, token, storageId })
  const thread = (id: string, timestamp: number) => ({ id, title: id, users: [], lastSeenAt: [],
    messages: [{ id: `message-${id}-${timestamp}`, senderId: 'viewer', text: id, timestamp, kind: 'text' }] })
  const save = (mode: 'full' | 'unread', threads: ReturnType<typeof thread>[]) =>
    t.mutation(internal.chatCache.saveInbox, { profileId, token, viewerId: 'viewer', mode, threads })

  await save('full', [thread('read', 100), thread('updated', 200)])
  const merged = await save('unread', [thread('updated', 300), thread('new', 400)])
  expect(merged.threads.map(item => item.id)).toEqual(['new', 'updated', 'read'])
  expect((await t.query(internal.chatCache.inbox, { profileId })).threads.map(item => item.id))
    .toEqual(['new', 'updated', 'read'])
  vi.stubEnv('INTERNAL_API_KEY', 'test-key')
  const empty = await t.fetch('/api/chat/cache', { method: 'POST', headers,
    body: JSON.stringify({ scope: 'inbox', profileId, token, viewerId: 'viewer', mode: 'unread', threads: [] }) })
  expect(empty.status).toBe(200)
  expect((await empty.json()).threads.map((item: { id: string }) => item.id)).toEqual(['new', 'updated', 'read'])
})

test('Full inbox snapshots keep every fetched conversation', async () => {
  const t = createConvexTest()
  const profileId = (await seedProfile(t))!._id
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(['{}'])))
  await t.mutation(internal.profiles.mutations.saveChatSessionInternal, { profileId, token, storageId })
  const threads = Array.from({ length: 101 }, (_, i) => ({ id: String(i), title: String(i),
    users: [], messages: [], lastSeenAt: [] }))
  await t.mutation(internal.chatCache.saveInbox, { profileId, token, viewerId: 'viewer', threads })
  expect((await t.query(internal.chatCache.inbox, { profileId })).threads).toHaveLength(101)
})

test('A stale thread response keeps a newer inbox message visible', async () => {
  const t = createConvexTest()
  const profileId = (await seedProfile(t))!._id
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(['{}'])))
  await t.mutation(internal.profiles.mutations.saveChatSessionInternal, { profileId, token, storageId })
  const message = (id: string, timestamp: number) =>
    ({ id, senderId: 'friend', text: id, timestamp, kind: 'text' })
  const shell = { id: '123', title: 'Friend', users: [], lastSeenAt: [] }
  await t.mutation(internal.chatCache.saveInbox, { profileId, token, viewerId: 'viewer',
    threads: [{ ...shell, messages: [message('new', 300)] }] })
  const saved = await t.mutation(internal.chatCache.saveConversation, { profileId, token,
    thread: { ...shell, messages: [message('old', 100), message('middle', 200)] } })
  expect(saved.messages.map(item => item.id)).toEqual(['new', 'middle', 'old'])
  expect((await t.query(internal.chatCache.inbox, { profileId })).threads[0].messages[0].id).toBe('new')
  expect((await t.query(internal.chatCache.conversation, { profileId, threadId: shell.id }))?.messages
    .map(item => item.id)).toEqual(['new', 'middle', 'old'])
})

test('Conversation sync returns the same bounded history as subsequent cache reads', async () => {
  const t = createConvexTest()
  const profile = (await seedProfile(t))!
  const profileId = profile._id
  await t.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(['{}']))
    await ctx.db.insert('chatSessions', { profileId, token, storageId })
  })
  const shell = { id: '123', title: 'Friend', users: [], lastSeenAt: [] }
  const messages = Array.from({ length: 100 }, (_, i) => ({ id: String(i), senderId: 'friend',
    text: String(i), timestamp: 100 - i, kind: 'text' }))
  await t.mutation(internal.chatCache.saveConversation, { profileId, token, thread: { ...shell, messages } })
  await t.run(async ctx => {
    const row = await ctx.db.query('chatThreads').unique()
    if (!row) throw new Error('Missing Chat thread')
    await ctx.db.patch(row._id, { threadSyncedAt: 1 })
  })
  await t.mutation(internal.chatCache.saveConversation, { profileId, token,
    thread: { ...shell, messages: messages.slice(0, 8).reverse() } })
  expect((await t.run(ctx => ctx.db.query('chatThreads').unique()))?.preview?.id).toBe('0')
  const unchanged = await t.mutation(internal.chatCache.saveConversation, { profileId, token,
    thread: { ...shell, messages: messages.slice(0, 8) } })
  expect(unchanged.syncedAt).toBe(1)
  expect((await t.run(ctx => ctx.db.query('chatThreads').unique()))?.threadSyncedAt).toBe(1)
  const seenOnly = await t.mutation(internal.chatCache.saveConversation, { profileId, token,
    thread: { ...shell, messages: messages.slice(0, 8), lastSeenAt: [{ userId: 'friend', timestamp: 100 }] } })
  expect(seenOnly.syncedAt).toBeGreaterThan(1)
  expect(seenOnly.lastSeenAt).toEqual([{ userId: 'friend', timestamp: 100 }])
  const fresh = await t.mutation(internal.chatCache.saveConversation, { profileId, token,
    thread: { ...shell, messages: [{ ...messages[0], id: 'latest', timestamp: 101 }, ...messages.slice(0, 7)] } })
  const cached = await t.query(internal.chatCache.conversation, { profileId, threadId: shell.id })
  expect(fresh).toEqual(cached)
  expect(fresh.messages).toHaveLength(20)
  expect(fresh.messages[0].id).toBe('latest')
  expect(fresh.messages.at(-1)?.id).toBe('18')
  expect((await t.run(ctx => ctx.db.query('chatHistories').unique()))?.messages).toHaveLength(20)
  await expect(t.mutation(internal.chatCache.saveInbox, { profileId, token, viewerId: 'viewer',
    threads: [{ ...shell, messages }] })).rejects.toThrow('one preview')
})

test('Batched cache cleanup preserves a replacement session and rejects stale writes', async () => {
  vi.useFakeTimers()
  try {
    const t = createConvexTest()
    const profileId = (await seedProfile(t))!._id
    const replacement = '22222222-2222-4222-8222-222222222222'
    const storageId = await t.run(ctx => ctx.storage.store(new Blob(['{}'])))
    await t.mutation(internal.profiles.mutations.saveChatSessionInternal, { profileId, storageId, token })
    const thread = { id: '123', title: 'Friend', users: [], messages: [], lastSeenAt: [] }
    for (let i = 0; i < 30; i++) {
      await t.mutation(internal.chatCache.saveConversation, { profileId, token, thread: { ...thread, id: String(i) } })
    }
    const nextStorageId = await t.run(ctx => ctx.storage.store(new Blob(['{}'])))
    await t.mutation(internal.profiles.mutations.saveChatSessionInternal, {
      profileId, storageId: nextStorageId, token: replacement,
    })
    await t.mutation(internal.chatCache.saveConversation, { profileId, token: replacement, thread })
    await expect(t.mutation(internal.chatCache.saveConversation, { profileId, token, thread }))
      .rejects.toThrow('Chat session changed')
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    for (const table of ['chatThreads', 'chatHistories'] as const) {
      const rows = await t.run(ctx => ctx.db.query(table).collect())
      expect(rows).toHaveLength(1)
      expect(rows[0].sessionToken).toBe(replacement)
    }
    expect((await t.query(internal.chatCache.inbox, { profileId })).threads).toEqual([])
  } finally { vi.useRealTimers() }
})
