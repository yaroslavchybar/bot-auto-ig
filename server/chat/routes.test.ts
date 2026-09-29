import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

test('a sent DM stays successful when Chat refresh fails', () => {
  execFileSync('bun', ['--eval', `
    import assert from 'node:assert/strict'
    import { mock } from 'bun:test'
    import express from 'express'

    let sends = 0
    let refreshes = 0
    let warnings = 0
    let failSend = false
    let failRefresh = false
    let failUnsentMark = true
    let lastContext
    let attachmentKind
    let attachmentBytes
    let reactedEmoji
    const reactedContexts = []
    const reactionRemovals = []
    let unsentItem
    let unsentCacheItem
    const invalidations = []
    const olderQueries = []
    let releaseRefresh
    const refreshGate = new Promise(resolve => { releaseRefresh = resolve })
    const profile = { id: 'profile-1', name: 'Profile', igLoggedIn: true }

    mock.module('./server/shared/convexClient.ts', () => ({
      profilesGetById: async () => profile,
      profilesList: async () => [profile],
      chatMarkUnsent: async (_profileId, _token, _threadId, itemId) => {
        unsentCacheItem = itemId
        if (failUnsentMark) throw new Error('Convex unavailable')
        return { profileIds: ['profile-1', 'profile-2'] }
      },
    }))
    mock.module('./server/chat/sync.ts', () => ({
      cachedInbox: async () => ({ connected: true, threads: [] }),
      cachedThread: async () => null,
      clearSyncFailures: () => {},
      invalidateChatSnapshots: (profileId, threadId) => { invalidations.push([profileId, threadId]) },
      threadSyncs: new Map(),
      syncThread: async () => {
        refreshes++
        if (refreshes === 1) await refreshGate
        if (failRefresh) throw new Error('Refresh unavailable')
        return { id: '123', messages: [] }
      },
    }))
    mock.module('./server/chat/instagram.ts', () => ({
      InstagramChat: class {
        static hasSession = async () => { throw new Error('Redundant session check') }
        static load = async () => new this()
        cacheToken = 'session-token'
        async reply(_threadId, _text, clientContext) {
          sends++
          lastContext = clientContext
          if (failSend) throw new Error('Instagram send failed')
          return { id: String(sends), senderId: 'viewer', text: 'Hello', timestamp: Date.now(), kind: 'text' }
        }
        async sendAttachment(_threadId, kind, bytes) {
          attachmentKind = kind
          attachmentBytes = bytes.length
          return { id: 'media-1', senderId: 'viewer', text: '', timestamp: Date.now(), kind, mediaType: kind }
        }
        async react(_threadId, item, emoji, remove) {
          assert.equal(item.id, '12345')
          reactedEmoji = emoji
          reactedContexts.push(item.clientContext)
          reactionRemovals.push(remove)
        }
        async unsend(_threadId, itemId) {
          unsentItem = itemId
        }
        async conversationPage(_threadId, cursor) {
          olderQueries.push(cursor)
          const start = cursor === 'p2' ? 20 : cursor === 'p3' ? 10 : 30
          return { thread: { messages: Array.from({ length: 10 }, (_, i) => ({
            id: String(start - i), senderId: 'friend', text: '', timestamp: start - i, kind: 'text',
          })) }, nextCursor: cursor === '' ? 'p2' : cursor === 'p2' ? 'p3' : '', hasOlder: cursor !== 'p3' }
        }
      },
    }))
    mock.module('./server/shared/logger.ts', () => ({ addLogContext: () => {}, default: { error: () => { warnings++ } } }))

    const { default: router } = await import('./server/chat/routes.ts')
    const app = express()
    app.use(express.json())
    app.use('/api/chat', router)
    app.use((err, _req, res, _next) => res.status(err.statusCode ?? 500).json({ error: err.message }))
    const server = app.listen(0)
    try {
      const port = server.address().port
      const older = await fetch('http://127.0.0.1:' + port + '/api/chat/profile-1/threads/123/older?before=16')
      assert.equal(older.status, 200)
      const firstPage = await older.json()
      assert.deepEqual(firstPage.messages.map(message => message.id),
        Array.from({ length: 10 }, (_, i) => String(15 - i)))
      assert.equal(firstPage.nextCursor, 'p3')
      assert.equal(firstPage.hasOlder, true)
      assert.deepEqual(olderQueries, ['', 'p2', 'p3'])
      const finalPage = await fetch('http://127.0.0.1:' + port +
        '/api/chat/profile-1/threads/123/older?before=6&beforeId=6&cursor=p3')
      assert.equal(finalPage.status, 200)
      const lastPage = await finalPage.json()
      assert.deepEqual(lastPage.messages.map(message => message.id), ['5', '4', '3', '2', '1'])
      assert.equal(lastPage.hasOlder, false)
      assert.equal((await fetch('http://127.0.0.1:' + port + '/api/chat/profile-1/threads/123/older?before=nope')).status, 400)
      const send = () => fetch('http://127.0.0.1:' + port + '/api/chat/profile-1/threads/123/reply', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Hello', clientContext: '11111111-1111-4111-8111-111111111111' }),
      })
      const first = await send()
      assert.equal(first.status, 200)
      assert.equal((await first.json()).message.id, '1')
      assert.equal(sends, 1)
      assert.equal(lastContext, '11111111-1111-4111-8111-111111111111')
      assert.equal(refreshes, 1)
      assert.equal(warnings, 0)
      releaseRefresh()
      await new Promise(resolve => setTimeout(resolve, 0))

      failRefresh = true
      const second = await send()
      assert.equal(second.status, 200)
      assert.equal(sends, 2)
      await new Promise(resolve => setTimeout(resolve, 0))
      assert.equal(warnings, 1)

      failSend = true
      const third = await send()
      assert.equal(third.status, 503)
      assert.equal(refreshes, 2)

      const attachment = await fetch('http://127.0.0.1:' + port + '/api/chat/profile-1/threads/123/attachment?kind=photo', {
        method: 'POST', headers: { 'content-type': 'application/octet-stream' },
        body: Buffer.from([255, 216, 255]),
      })
      assert.equal(attachment.status, 200)
      assert.equal((await attachment.json()).message.id, 'media-1')
      assert.equal(attachmentKind, 'photo')
      assert.equal(attachmentBytes, 3)

      const reaction = await fetch('http://127.0.0.1:' + port + '/api/chat/profile-1/threads/123/reaction', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messageId: '12345', kind: 'text', emoji: '❤️', remove: false }),
      })
      assert.equal(reaction.status, 200)
      assert.equal(reactedEmoji, '❤️')
      const reactWithContext = clientContext => fetch('http://127.0.0.1:' + port + '/api/chat/profile-1/threads/123/reaction', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messageId: '12345', kind: 'text', emoji: '❤️', remove: false, clientContext }),
      })
      assert.equal((await reactWithContext('')).status, 200)
      assert.equal((await reactWithContext('17803451234567890')).status, 200)
      assert.deepEqual(reactedContexts, [undefined, undefined, '17803451234567890'])
      const unreact = await fetch('http://127.0.0.1:' + port + '/api/chat/profile-1/threads/123/reaction', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messageId: '12345', kind: 'text', emoji: '❤️', remove: true }),
      })
      assert.equal(unreact.status, 200)
      assert.deepEqual(reactionRemovals, [false, false, false, true])

      const unsend = await fetch('http://127.0.0.1:' + port + '/api/chat/profile-1/threads/123/unsend', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messageId: '12345' }),
      })
      assert.equal(unsend.status, 200)
      assert.equal(unsentItem, '12345')
      assert.equal(unsentCacheItem, '12345')
      failUnsentMark = false
      const before = invalidations.length
      assert.equal((await fetch('http://127.0.0.1:' + port + '/api/chat/profile-1/threads/123/unsend', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messageId: '12345' }),
      })).status, 200)
      assert.deepEqual(invalidations.slice(before), [['profile-1', '123'], ['profile-2', '123']])
    } finally {
      server.close()
    }
  `], { cwd: process.cwd(), stdio: 'pipe', timeout: 30_000 });
});
