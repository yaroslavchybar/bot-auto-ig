import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

test('a sent DM stays successful when Chat cache bookkeeping fails', () => {
  execFileSync('bun', ['--eval', `
    import assert from 'node:assert/strict'
    import { mock } from 'bun:test'
    import express from 'express'

    let sends = 0
    let marks = 0
    let refreshes = 0
    let warnings = 0
    let failSend = false
    let failMark = true
    let failRefresh = false
    let lastContext
    let releaseRefresh
    const refreshGate = new Promise(resolve => { releaseRefresh = resolve })
    const profile = { id: 'profile-1', name: 'Profile', igLoggedIn: true }

    mock.module('./server/shared/convexClient.ts', () => ({
      profilesGetById: async () => profile,
      profilesList: async () => [profile],
      chatMarkReplied: async () => {
        marks++
        if (failMark) throw new Error('Convex unavailable')
      },
    }))
    mock.module('./server/chat/sync.ts', () => ({
      cachedInbox: async () => ({ connected: true, threads: [] }),
      cachedThread: async () => null,
      clearSyncFailures: () => {},
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
      },
    }))
    mock.module('./server/shared/logger.ts', () => ({ default: { warn: () => { warnings++ } } }))

    const { default: router } = await import('./server/chat/routes.ts')
    const app = express()
    app.use(express.json())
    app.use('/api/chat', router)
    app.use((err, _req, res, _next) => res.status(err.statusCode ?? 500).json({ error: err.message }))
    const server = app.listen(0)
    try {
      const port = server.address().port
      const send = () => fetch('http://127.0.0.1:' + port + '/api/chat/profile-1/threads/123/reply', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Hello', clientContext: '11111111-1111-4111-8111-111111111111' }),
      })
      const first = await send()
      assert.equal(first.status, 200)
      assert.equal((await first.json()).message.id, '1')
      assert.equal(sends, 1)
      assert.equal(lastContext, '11111111-1111-4111-8111-111111111111')
      assert.equal(marks, 1)
      assert.equal(refreshes, 1)
      assert.equal(warnings, 1)
      releaseRefresh()
      await new Promise(resolve => setTimeout(resolve, 0))

      failMark = false
      failRefresh = true
      const second = await send()
      assert.equal(second.status, 200)
      assert.equal(sends, 2)
      assert.equal(warnings, 2)

      failSend = true
      const third = await send()
      assert.equal(third.status, 503)
      assert.equal(marks, 2)
      assert.equal(refreshes, 2)
    } finally {
      server.close()
    }
  `], { cwd: process.cwd(), stdio: 'pipe', timeout: 30_000 });
});
