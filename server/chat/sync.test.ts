import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

test('Chat polling reuses Convex reads and saves only changed data while background sync persists', () => {
  execFileSync('bun', ['--eval', `
    import assert from 'node:assert/strict'
    import { mock } from 'bun:test'

    const profile = { id: 'profile-1' }
    let now = 1_000_000
    Date.now = () => now
    let inboxReads = 0
    let threadReads = 0
    let inboxWrites = 0
    let threadWrites = 0
    let inboxFetches = 0
    const inboxModes = []
    let threadFetches = 0
    let messageText = 'hello'
    let cachedThread = { id: '123', title: 'Friend', users: [], messages: [], lastSeenAt: [], syncedAt: 1 }
    let cachedInbox = { connected: true, viewerId: 'viewer', threads: [], syncedAt: 0 }
    const thread = () => ({ id: '123', title: 'Friend', users: [],
      messages: [{ id: 'm1', senderId: 'friend', text: messageText, timestamp: 10, kind: 'text' }], lastSeenAt: [] })
    mock.module('./server/shared/convexClient.ts', () => ({
      chatCacheInbox: async () => { inboxReads++; return cachedInbox },
      chatCacheSaveInbox: async (_profileId, _token, inbox) => {
        inboxWrites++
        cachedInbox = { connected: true, ...inbox, syncedAt: now }
        return cachedInbox
      },
      chatCacheThread: async () => { threadReads++; return cachedThread },
      chatCacheSaveThread: async (_profileId, _token, value) => {
        threadWrites++
        cachedThread = { ...value, confirmedMessageIds: value.messages.map(message => message.id).sort(), syncedAt: now }
        return cachedThread
      },
    }))
    mock.module('./server/chat/instagram.ts', () => ({
      InstagramChat: class {
        static load = async () => new this()
        cacheToken = 'session-token'
        async inbox(unreadOnly) { inboxFetches++; inboxModes.push(unreadOnly); return { viewerId: 'viewer', threads: [thread()] } }
        async conversation() { threadFetches++; return thread() }
      },
    }))

    const { cachedInbox: readInbox, cachedThread: readThread, clearSyncFailures,
      invalidateChatSnapshots } = await import('./server/chat/sync.ts')
    await readThread(profile, '123')
    await readThread(profile, '123')
    assert.equal(threadReads, 1)
    assert.equal(threadFetches, 1)
    assert.equal(threadWrites, 1)

    now += 21_000
    await readThread(profile, '123')
    assert.equal(threadFetches, 2)
    assert.equal(threadWrites, 1)

    messageText = 'changed'
    now += 21_000
    await readThread(profile, '123')
    assert.equal(threadWrites, 2)

    await readInbox(profile)
    await readInbox(profile)
    assert.equal(inboxReads, 1)
    assert.equal(inboxFetches, 1)
    assert.equal(inboxWrites, 1)

    now += 61_000
    await readInbox(profile)
    assert.equal(inboxFetches, 2)
    assert.equal(inboxWrites, 1)
    now += 61_000
    await readInbox(profile)
    assert.equal(inboxFetches, 3)
    assert.equal(inboxWrites, 1)
    assert.deepEqual(inboxModes, [false, true, true])

    messageText = 'new inbox message'
    now += 61_000
    await readInbox(profile)
    assert.equal(inboxWrites, 2)

    now += 61_000
    await readInbox(profile, true, true)
    assert.equal(inboxWrites, 3) // The 15-minute worker persists directly.
    assert.equal(inboxReads, 2)
    assert.equal(inboxModes.at(-1), true)
    await readInbox(profile, true)
    assert.equal(inboxModes.at(-1), true)
    assert.equal(inboxWrites, 3)

    invalidateChatSnapshots(profile.id)
    await readInbox(profile)
    assert.equal(inboxReads, 3)

    clearSyncFailures(profile.id)
    await readThread(profile, '123')
    assert.equal(threadReads, 2)

    clearSyncFailures(profile.id)
    cachedInbox = { connected: false, viewerId: '', threads: [], syncedAt: 0 }
    await readInbox(profile)
    assert.equal((await readInbox(profile)).connected, false)
    cachedInbox = { connected: true, viewerId: 'viewer', threads: [], syncedAt: 0 }
    now += 61_000
    assert.equal((await readInbox(profile)).connected, true)
  `], { cwd: process.cwd(), stdio: 'pipe' });
});
