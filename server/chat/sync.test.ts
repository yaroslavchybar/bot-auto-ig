import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

test('Chat sync keeps unchanged threads fresh and polls only unread inboxes after the first snapshot', () => {
  execFileSync('bun', ['--eval', `
    import assert from 'node:assert/strict'
    import { mock } from 'bun:test'

    const profile = { id: 'profile-1' }
    let fetched = 0
    let saved = 0
    let cached = { id: '123', title: 'Friend', users: [], messages: [], lastSeenAt: [], syncedAt: 1 }
    let inboxCache = { connected: true, viewerId: 'viewer', threads: [], syncedAt: 0 }
    const inboxModes = []
    const inboxFilters = []
    mock.module('./server/shared/convexClient.ts', () => ({
      chatCacheInbox: async () => inboxCache,
      chatCacheSaveInbox: async (_profileId, _token, _inbox, mode) => {
        inboxModes.push(mode)
        inboxCache = { ...inboxCache, syncedAt: 1 }
        return inboxCache
      },
      chatCacheThread: async () => cached,
      chatCacheSaveThread: async () => { saved++; return cached },
    }))
    mock.module('./server/chat/instagram.ts', () => ({
      InstagramChat: class {
        static load = async () => new this()
        cacheToken = 'session-token'
        async inbox(onlyUnread) { inboxFilters.push(onlyUnread); return { viewerId: 'viewer', threads: [] } }
        async conversation() { fetched++; return cached }
      },
    }))

    const { cachedInbox, cachedThread, clearSyncFailures } = await import('./server/chat/sync.ts')
    await cachedThread(profile, '123')
    await cachedThread(profile, '123')
    assert.equal(fetched, 1)
    assert.equal(saved, 1)

    // A replacement cache row cannot inherit the previous row's in-memory freshness.
    cached = { ...cached, syncedAt: 2 }
    await cachedThread(profile, '123')
    assert.equal(fetched, 2)

    clearSyncFailures(profile.id)
    await cachedThread(profile, '123')
    assert.equal(fetched, 3)

    await cachedInbox(profile)
    await cachedInbox(profile)
    await cachedInbox(profile, true)
    assert.deepEqual(inboxModes, ['full', 'unread', 'unread'])
    assert.deepEqual(inboxFilters, [false, true, true])

    const now = Date.now
    Date.now = () => now() + 10 * 60_000 + 1
    try { await cachedInbox(profile) }
    finally { Date.now = now }
    assert.deepEqual(inboxModes, ['full', 'unread', 'unread', 'unread'])
    assert.deepEqual(inboxFilters, [false, true, true, true])
  `], { cwd: process.cwd(), stdio: 'pipe' });
});
