import { afterEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ChatCache } from './cache.js'
import type { ChatMessage, ChatThread } from './instagram.js'

let cache: ChatCache | undefined
afterEach(() => {
  cache?.close()
  cache = undefined
})
const message = (id: string, timestamp: number, senderId = 'friend'): ChatMessage => ({
  id,
  timestamp,
  senderId,
  text: id,
  kind: 'text',
})
const thread = (messages: ChatMessage[] = [], id = '123'): ChatThread => ({
  id,
  title: 'Friend',
  users: [],
  lastSeenAt: [],
  messages,
})
function setup() {
  cache = new ChatCache(':memory:')
  cache.connect('one', 'token', 'viewer')
  return cache
}

test('preview and history persist across restarts without Convex', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'chat-cache-'))
  const filename = path.join(directory, 'cache.sqlite')
  try {
    const first = new ChatCache(filename)
    first.connect('one', 'token', 'viewer')
    first.saveInbox('one', 'token', { viewerId: 'viewer', threads: [thread([message('1', 100)])] })
    first.saveThread('one', 'token', thread([message('1', 100)]))
    first.close()
    const second = new ChatCache(filename)
    expect(second.inbox('one').threads[0].messages[0].id).toBe('1')
    expect(second.thread('one', '123')?.confirmedMessageIds).toEqual(['1'])
    second.close()
  } finally {
    expect(path.dirname(path.resolve(directory))).toBe(path.resolve(os.tmpdir()))
    expect(path.basename(directory).startsWith('chat-cache-')).toBe(true)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('read receipts do not clear unanswered chats; replies do', () => {
  const store = setup()
  const incoming = message('1', 100)
  store.saveInbox('one', 'token', { viewerId: 'viewer', threads: [thread([incoming])] })
  expect(store.unreadCount('one')).toBe(1)
  store.saveThread('one', 'token', {
    ...thread([incoming]),
    lastSeenAt: [{ userId: 'viewer', timestamp: 200 }],
  })
  expect(store.unreadCount('one')).toBe(1)
  store.saveThread('one', 'token', thread([message('2', 200, 'viewer'), incoming]), Date.now() + 1)
  expect(store.unreadCount('one')).toBe(0)
  store.markUnsent('one', 'token', '123', '2')
  expect(store.unreadCount('one')).toBe(1)
  store.saveThread('one', 'token', thread([message('2', 200, 'viewer'), incoming]))
  expect(store.thread('one', '123')?.messages.map((item) => item.id)).toEqual(['1'])
  expect(store.unreadCount('one')).toBe(1)
})

test('unread-only sync retains other chats and previews are not confirmations', () => {
  const store = setup()
  store.saveInbox('one', 'token', {
    viewerId: 'viewer',
    threads: [thread([message('1', 100)]), thread([], '456')],
  })
  expect(store.thread('one', '123')?.confirmedMessageIds).toBeUndefined()
  store.saveInbox('one', 'token', { viewerId: 'viewer', threads: [] }, 'unread')
  expect(store.inbox('one').threads).toHaveLength(2)
  expect(store.unreadCount('one')).toBe(1)
})

test('a concurrent newer inbox preview wins, including edited media and reactions', () => {
  const store = setup()
  const newer = {
    ...message('2', 200),
    mediaType: 'photo' as const,
    mediaUrl: 'https://example.com/image',
    reactions: [{ senderId: 'viewer', emoji: '❤️' }],
  }
  const fetchedAt = Date.now() - 1
  store.saveInbox('one', 'token', { viewerId: 'viewer', threads: [thread([newer])] })
  expect(
    store
      .saveThread('one', 'token', thread([message('1', 100)]), fetchedAt)
      .messages.map((item) => item.id),
  ).toEqual(['2', '1'])
  expect(store.thread('one', '123')?.messages[0]).toMatchObject(newer)
  store.saveThread('one', 'token', thread([message('2', 200)]), fetchedAt)
  expect(store.thread('one', '123')?.messages[0]).toMatchObject(newer)
  store.saveThread('one', 'token', thread([message('1', 100)]), Date.now() + 1)
  expect(store.thread('one', '123')?.messages.map((item) => item.id)).toEqual(['1'])
})

test('unsend reaches both connected sides and stale sync cannot restore it', () => {
  const store = setup()
  store.connect('two', 'other', 'friend')
  const content = thread([message('2', 200, 'viewer'), message('1', 100)])
  for (const [id, token, viewerId] of [
    ['one', 'token', 'viewer'],
    ['two', 'other', 'friend'],
  ]) {
    store.saveInbox(id, token, {
      viewerId,
      threads: [{ ...content, messages: content.messages.slice(0, 1) }],
    })
    store.saveThread(id, token, content)
  }
  expect(store.markUnsent('one', 'token', '123', '2')).toEqual(['one', 'two'])
  for (const [id, token, viewerId] of [
    ['one', 'token', 'viewer'],
    ['two', 'other', 'friend'],
  ]) {
    store.saveInbox(id, token, {
      viewerId,
      threads: [{ ...content, messages: content.messages.slice(0, 1) }],
    })
    store.saveThread(id, token, content)
    expect(store.thread(id, '123')?.messages.map((item) => item.id)).toEqual(['1'])
  }
})

test('session replacement, logout, and deleted profiles isolate cached messages', () => {
  const store = setup()
  store.saveThread('one', 'token', thread([message('1', 100)]))
  store.connect('one', 'replacement')
  expect(store.thread('one', '123')).toBeNull()
  expect(() => store.saveThread('one', 'token', thread())).toThrow('session changed')
  store.retainProfiles([])
  expect(store.inbox('one').connected).toBe(false)
  expect(() => store.saveInbox('one', 'replacement', { viewerId: 'viewer', threads: [] })).toThrow(
    'session changed',
  )
})

test('history and disk cache are bounded; identical snapshots do not write', () => {
  const store = setup()
  const messages = Array.from({ length: 100 }, (_, i) => message(String(i), 100 - i))
  store.saveThread('one', 'token', thread(messages))
  expect(store.thread('one', '123')?.messages).toHaveLength(30)
  const db = (store as unknown as { db: Database }).db
  const before = db.query<{ count: number }, []>('SELECT total_changes() AS count').get()!.count
  const saved = store.saveThread('one', 'token', thread(messages))
  expect(db.query<{ count: number }, []>('SELECT total_changes() AS count').get()!.count).toBe(
    before,
  )
  expect(saved).toEqual(store.thread('one', '123'))
  for (let i = 0; i < 250; i++) store.saveThread('one', 'token', thread([], String(i)))
  expect(
    db.query<{ count: number }, []>('SELECT count(*) AS count FROM threads').get()!.count,
  ).toBe(200)
  expect(() =>
    store.saveInbox('one', 'token', { viewerId: 'viewer', threads: [thread(messages)] }),
  ).toThrow('one preview')
})
