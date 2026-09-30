import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

test('shared cache publishes only changed counters, retries errors, and never blocks messages', () => {
  execFileSync(
    'bun',
    [
      '--eval',
      `
    import assert from 'node:assert/strict'
    import { mock } from 'bun:test'
    import { ChatCache } from './server/chat/cache.ts'
    const cache = new ChatCache(':memory:')
    cache.connect('one', 'token', 'viewer')
    const calls = []
    const events = []
    let errors = 0
    let release
    let fail = false
    let slow = false
    mock.module('./server/chat/cache.ts', () => ({ getChatCache: () => cache }))
    mock.module('./server/chat/instagram.ts', () => ({ InstagramChat: { hasSession: async () => true } }))
    mock.module('./server/websocket.ts', () => ({ broadcast: event => events.push(event) }))
    mock.module('./server/shared/logger.ts', () => ({ default: { error: () => { errors++ } } }))
    mock.module('./server/shared/convexClient.ts', () => ({ chatUnreadSave: async (...args) => {
      calls.push(args)
      if (slow) await new Promise(resolve => { release = resolve })
      if (fail) throw new Error('network unavailable')
    } }))
    const { publishUnread, chatCacheSaveInbox, chatCacheSaveThread, chatMarkUnsent } = await import('./server/chat/store.ts')
    const incoming = { id: '1', senderId: 'friend', text: 'hello', timestamp: 100, kind: 'text' }
    const reply = { id: '2', senderId: 'viewer', text: 'hi', timestamp: 200, kind: 'text' }
    const shell = { id: '123', title: 'Friend', users: [], lastSeenAt: [] }
    const inbox = { viewerId: 'viewer', threads: [{ ...shell, messages: [incoming] }] }
    await publishUnread('one', 'token')
    assert.equal(calls.length, 0) // Do not overwrite durable counts before the first inbox fetch.
    slow = true
    const saved = await chatCacheSaveInbox('one', 'token', inbox)
    assert.equal(saved.threads.length, 1) // Counter network I/O is still pending.
    release()
    slow = false
    await publishUnread('one', 'token')
    assert.deepEqual(calls, [['one', 'token', 1]])
    await chatCacheSaveInbox('one', 'token', inbox)
    await publishUnread('one', 'token')
    assert.equal(calls.length, 1)
    assert.equal(events.length, 1)
    fail = true
    await chatCacheSaveThread('one', 'token', { ...shell, messages: [reply, incoming] }, Date.now() + 1)
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(errors, 1)
    fail = false
    await publishUnread('one', 'token')
    assert.deepEqual(calls.at(-1), ['one', 'token', 0])
    cache.connect('two', 'other', 'friend')
    cache.saveInbox('two', 'other', { viewerId: 'friend', threads: [{ ...shell, messages: [reply] }] })
    cache.saveThread('two', 'other', { ...shell, messages: [reply, incoming] })
    await publishUnread('two', 'other')
    await chatMarkUnsent('one', 'token', '123', '2')
    await publishUnread('one', 'token')
    await publishUnread('two', 'other')
    assert.deepEqual(calls.slice(-2), [['one', 'token', 1], ['two', 'other', 0]])
    const newerReply = { ...reply, id: '3', timestamp: 300 }
    cache.saveThread('one', 'token', { ...shell, messages: [newerReply, incoming] }, Date.now() + 1)
    const before = calls.length
    slow = true
    const changing = publishUnread('one', 'token')
    cache.markUnsent('one', 'token', '123', '3')
    const followers = [publishUnread('one', 'token'), publishUnread('one', 'token'), publishUnread('one', 'token')]
    release()
    slow = false
    await Promise.all([changing, ...followers])
    assert.equal(calls.length - before, 2) // Concurrent followers publish only the newest changed count once.
    assert.ok(events.every(event => !('messages' in event)))
    cache.close()
  `,
    ],
    { cwd: process.cwd(), stdio: 'pipe' },
  )
})
