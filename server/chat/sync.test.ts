import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

test('Disconnected inbox checks are throttled until expiry, force, or invalidation', () => {
  execFileSync(
    'bun',
    [
      '--eval',
      `
    import assert from 'node:assert/strict'
    import { mock } from 'bun:test'
    let now = 1_000_000
    Date.now = () => now
    let loads = 0
    let loadError = new Error('Connect this profile to Instagram Chat first')
    mock.module('./server/chat/store.ts', () => ({
      publishUnread: async () => {},
      chatCacheInbox: async () => { throw new Error('Unexpected cache read') },
      chatCacheSaveInbox: async () => {},
      chatCacheThread: async () => {},
      chatCacheSaveThread: async () => {},
    }))
    mock.module('./server/chat/instagram.ts', () => ({
      InstagramChat: { load: async () => { loads++; throw loadError } },
    }))
    const { cachedInbox, clearSyncFailures } = await import('./server/chat/sync.ts')
    const profile = { id: 'disconnected' }
    const result = await cachedInbox(profile)
    assert.deepEqual(result, { connected: false, viewerId: '', threads: [], syncedAt: 0 })
    now += 59_999
    assert.equal(await cachedInbox(profile), result)
    assert.equal(loads, 1)
    now++
    await cachedInbox(profile)
    assert.equal(loads, 2)
    await cachedInbox(profile, true)
    assert.equal(loads, 3)
    clearSyncFailures(profile.id)
    await cachedInbox(profile)
    assert.equal(loads, 4)
    loadError = new Error('Unexpected session failure')
    await assert.rejects(cachedInbox(profile, true), /Unexpected session failure/)
    assert.equal(loads, 5)
  `,
    ],
    { cwd: process.cwd(), stdio: 'pipe' },
  )
})

test('Chat polling reuses disk reads and skips unchanged writes, including background sync', () => {
  execFileSync(
    'bun',
    [
      '--eval',
      `
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
    mock.module('./server/chat/store.ts', () => ({
      publishUnread: async () => {},
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
    await readInbox(profile, true)
    assert.equal(inboxWrites, 2) // Background checks also skip unchanged data.
    assert.equal(inboxReads, 1)
    assert.equal(inboxModes.at(-1), true)
    await readInbox(profile, true)
    assert.equal(inboxModes.at(-1), true)
    assert.equal(inboxWrites, 2)

    invalidateChatSnapshots(profile.id)
    await readInbox(profile)
    assert.equal(inboxReads, 2)

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
  `,
    ],
    { cwd: process.cwd(), stdio: 'pipe' },
  )
})
