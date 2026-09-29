import { afterEach, expect, test, vi } from 'vite-plus/test'
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
  const newMessage = { ...message('new', 300), text: '', kind: 'photo_attachment',
    mediaType: 'photo' as const, mediaUrl: 'https://cdn.example/photo.jpg',
    reactions: [{ senderId: 'viewer', emoji: '❤️' }] }
  await t.mutation(internal.chatCache.saveInbox, { profileId, token, viewerId: 'viewer',
    threads: [{ ...shell, messages: [newMessage] }] })
  const saved = await t.mutation(internal.chatCache.saveConversation, { profileId, token,
    thread: { ...shell, messages: [message('old', 100), message('middle', 200)] } })
  expect(saved.messages.map(item => item.id)).toEqual(['new', 'middle', 'old'])
  expect((await t.query(internal.chatCache.inbox, { profileId })).threads[0].messages[0].id).toBe('new')
  expect((await t.query(internal.chatCache.conversation, { profileId, threadId: shell.id }))?.messages
    .map(item => item.id)).toEqual(['new', 'middle', 'old'])
  expect((await t.query(internal.chatCache.conversation, { profileId, threadId: shell.id }))?.messages[0])
    .toMatchObject({ mediaUrl: newMessage.mediaUrl, reactions: newMessage.reactions })
})

test('A concurrent inbox update wins for the same message and timestamp', async () => {
  const t = createConvexTest()
  const profileId = (await seedProfile(t))!._id
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(['{}'])))
  await t.mutation(internal.profiles.mutations.saveChatSessionInternal, { profileId, token, storageId })
  const shell = { id: '123', title: 'Friend', users: [], lastSeenAt: [] }
  const fetched = { id: '200', senderId: 'friend', text: 'before', timestamp: 200, kind: 'text' }
  const updated = { ...fetched, text: 'after' }
  const fetchedAt = Date.now() - 1
  await t.mutation(internal.chatCache.saveInbox, { profileId, token, viewerId: 'viewer',
    threads: [{ ...shell, messages: [updated] }] })
  const saved = await t.mutation(internal.chatCache.saveConversation, { profileId, token,
    thread: { ...shell, messages: [fetched] }, fetchedAt })
  expect(saved.messages[0]).toMatchObject(updated)
  expect((await t.query(internal.chatCache.conversation, { profileId, threadId: shell.id }))
    ?.messages[0]).toMatchObject(updated)
})

test('Unsent messages leave the cache and stale syncs cannot restore them', async () => {
  const t = createConvexTest()
  const profileId = (await seedProfile(t))!._id
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(['{}'])))
  await t.mutation(internal.profiles.mutations.saveChatSessionInternal, { profileId, token, storageId })
  const message = (id: string, timestamp: number) =>
    ({ id, senderId: 'viewer', text: id, timestamp, kind: 'text' })
  const old = message('101', 100)
  const unsent = message('102', 200)
  const thread = { id: '123', title: 'Friend', users: [], lastSeenAt: [], messages: [unsent, old] }
  await t.mutation(internal.chatCache.saveInbox, { profileId, token, viewerId: 'viewer',
    threads: [{ ...thread, messages: [unsent] }] })
  await t.mutation(internal.chatCache.saveConversation, { profileId, token, thread })
  vi.stubEnv('INTERNAL_API_KEY', 'test-key')
  const response = await t.fetch('/api/chat/cache', { method: 'POST', headers,
    body: JSON.stringify({ scope: 'unsent', profileId, token, threadId: thread.id, messageId: unsent.id }) })
  expect(response.status).toBe(200)
  expect((await t.query(internal.chatCache.conversation, { profileId, threadId: thread.id }))?.messages
    .map(item => item.id)).toEqual(['101'])
  expect((await t.query(internal.chatCache.inbox, { profileId })).threads[0].messages[0].id).toBe('101')
  await t.mutation(internal.chatCache.saveInbox, { profileId, token, viewerId: 'viewer',
    threads: [{ ...thread, messages: [unsent] }] })
  await t.mutation(internal.chatCache.saveConversation, { profileId, token, thread })
  expect((await t.query(internal.chatCache.conversation, { profileId, threadId: thread.id }))?.messages
    .map(item => item.id)).toEqual(['101'])
  expect((await t.query(internal.chatCache.inbox, { profileId })).threads[0].messages[0].id).toBe('101')
})

test('Unsend removes a message from both connected sides of a thread', async () => {
  const t = createConvexTest()
  const senderId = (await seedProfile(t, { name: 'Sender' }))!._id
  const receiverId = (await seedProfile(t, { name: 'Receiver' }))!._id
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(['{}'])))
  for (const profileId of [senderId, receiverId]) {
    await t.mutation(internal.profiles.mutations.saveChatSessionInternal, { profileId, token, storageId })
  }
  const old = { id: '100', senderId: 'sender', text: 'old', timestamp: 100, kind: 'text' }
  const removed = { ...old, id: '200', text: 'removed', timestamp: 200 }
  const thread = { id: '123', title: 'Chat', users: [], lastSeenAt: [], messages: [removed, old] }
  for (const profileId of [senderId, receiverId]) {
    await t.mutation(internal.chatCache.saveInbox, { profileId, token,
      viewerId: profileId === senderId ? 'sender' : 'receiver', threads: [{ ...thread, messages: [removed] }] })
    await t.mutation(internal.chatCache.saveConversation, { profileId, token, thread })
  }
  expect(await t.mutation(internal.chatCache.markUnsent, {
    profileId: senderId, token, threadId: thread.id, messageId: removed.id,
  })).toEqual([senderId, receiverId])
  for (const profileId of [senderId, receiverId]) {
    const conversation = await t.query(internal.chatCache.conversation, { profileId, threadId: thread.id })
    expect(conversation?.messages.map(message => message.id)).toEqual(['100'])
    expect((await t.query(internal.chatCache.inbox, { profileId })).threads[0].messages[0].id).toBe('100')
    await t.mutation(internal.chatCache.saveInbox, { profileId, token,
      viewerId: profileId === senderId ? 'sender' : 'receiver', threads: [{ ...thread, messages: [removed] }] })
    await t.mutation(internal.chatCache.saveConversation, { profileId, token, thread })
    expect((await t.query(internal.chatCache.conversation, { profileId, threadId: thread.id }))?.messages
      .map(message => message.id)).toEqual(['100'])
  }
})

test('Unsending the only reply makes an unanswered thread unread again', async () => {
  const t = createConvexTest()
  const profileId = (await seedProfile(t))!._id
  await t.mutation(api.profiles.mutations.setIgState, { profileId, igLoggedIn: true })
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(['{}'])))
  await t.mutation(internal.profiles.mutations.saveChatSessionInternal, { profileId, token, storageId })
  const incoming = { id: '100', senderId: 'friend', text: 'hello', timestamp: 100, kind: 'text' }
  const reply = { id: '200', senderId: 'viewer', text: 'hi', timestamp: 200, kind: 'text' }
  const thread = { id: '123', title: 'Friend', users: [], lastSeenAt: [], messages: [reply, incoming] }
  await t.mutation(internal.chatCache.saveInbox, { profileId, token, viewerId: 'viewer',
    threads: [{ ...thread, messages: [incoming] }] })
  await t.mutation(internal.chatCache.saveConversation, { profileId, token, thread })
  expect((await t.query(internal.chatCache.conversation, { profileId, threadId: thread.id }))?.unread).toBe(false)
  expect(await t.query(api.chatCache.unreadCount)).toBe(0)
  await t.mutation(internal.chatCache.markUnsent, {
    profileId, token, threadId: thread.id, messageId: reply.id,
  })
  const conversation = await t.query(internal.chatCache.conversation, { profileId, threadId: thread.id })
  expect(conversation?.messages.map(message => message.id)).toEqual(['100'])
  expect(conversation?.unread).toBe(true)
  expect(await t.query(api.chatCache.unreadCount)).toBe(1)
  await t.mutation(internal.chatCache.saveConversation, { profileId, token, thread })
  expect((await t.query(internal.chatCache.conversation, { profileId, threadId: thread.id }))?.unread).toBe(true)
})

test('A fresh thread response clears a stale inbox preview', async () => {
  const t = createConvexTest()
  const profileId = (await seedProfile(t))!._id
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(['{}'])))
  await t.mutation(internal.profiles.mutations.saveChatSessionInternal, { profileId, token, storageId })
  const old = { id: '100', senderId: 'friend', text: 'old', timestamp: 100, kind: 'text' }
  const missing = { ...old, id: '200', text: 'missing', timestamp: 200 }
  const shell = { id: '123', title: 'Friend', users: [], lastSeenAt: [] }
  await t.mutation(internal.chatCache.saveInbox, { profileId, token, viewerId: 'viewer',
    threads: [{ ...shell, messages: [missing] }] })
  await t.mutation(internal.chatCache.saveConversation, { profileId, token,
    thread: { ...shell, messages: [old] }, fetchedAt: Date.now() + 1 })
  expect((await t.query(internal.chatCache.conversation, { profileId, threadId: shell.id }))?.messages
    .map(message => message.id)).toEqual(['100'])
  expect((await t.query(internal.chatCache.conversation, { profileId, threadId: shell.id }))
    ?.confirmedMessageIds).toEqual(['100'])
})

test('Inbox previews are not confirmed until Instagram returns them in the thread', async () => {
  const t = createConvexTest()
  const profileId = (await seedProfile(t))!._id
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(['{}'])))
  await t.mutation(internal.profiles.mutations.saveChatSessionInternal, { profileId, token, storageId })
  const message = { id: '200', senderId: 'viewer', text: 'reply', timestamp: 200, kind: 'text' }
  const shell = { id: '123', title: 'Friend', users: [], lastSeenAt: [] }
  await t.mutation(internal.chatCache.saveInbox, { profileId, token, viewerId: 'viewer',
    threads: [{ ...shell, messages: [message] }] })
  expect((await t.query(internal.chatCache.conversation, { profileId, threadId: shell.id }))
    ?.confirmedMessageIds).toBeUndefined()
  await t.mutation(internal.chatCache.saveConversation, { profileId, token,
    thread: { ...shell, messages: [message] }, fetchedAt: Date.now() + 1 })
  expect((await t.query(internal.chatCache.conversation, { profileId, threadId: shell.id }))
    ?.confirmedMessageIds).toEqual(['200'])
})

test('Conversation sync returns the same bounded history as subsequent cache reads', async () => {
  const t = createConvexTest()
  const profile = (await seedProfile(t))!
  const profileId = profile._id
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(['{}'])))
  await t.mutation(internal.profiles.mutations.saveChatSessionInternal, { profileId, token, storageId })
  const shell = { id: '123', title: 'Friend', users: [], lastSeenAt: [] }
  const messages = Array.from({ length: 100 }, (_, i) => ({ id: String(i), senderId: 'friend',
    text: String(i), timestamp: 100 - i, kind: 'text' }))
  await t.mutation(internal.chatCache.saveConversation, { profileId, token, thread: { ...shell, messages } })
  await t.mutation(internal.chatCache.saveConversation, { profileId, token,
    thread: { ...shell, messages: messages.slice(0, 8).reverse() } })
  expect((await t.run(ctx => ctx.db.query('chatThreads').unique()))?.preview?.id).toBe('0')
  await t.run(async ctx => {
    const row = await ctx.db.query('chatThreads').unique()
    if (!row) throw new Error('Missing Chat thread')
    await ctx.db.patch(row._id, { threadSyncedAt: 1 })
  })
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
  expect(fresh.messages).toHaveLength(30)
  expect(fresh.messages[0].id).toBe('latest')
  expect(fresh.messages.at(-1)?.id).toBe('28')
  expect((await t.run(ctx => ctx.db.query('chatHistories').unique()))?.messages).toHaveLength(30)
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
