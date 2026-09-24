import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ profilesGetById: vi.fn(), cachedInbox: vi.fn(), warn: vi.fn(), watch: vi.fn(), unsubscribe: vi.fn() }))
vi.mock('../../server/shared/convexClient.js', () => ({ profilesGetById: mocks.profilesGetById }))
vi.mock('../../server/shared/convexRealtime.js', () => ({ watchChatProfiles: mocks.watch }))
vi.mock('../../server/chat/sync.js', () => ({ cachedInbox: mocks.cachedInbox }))
vi.mock('../../server/shared/logger.js', () => ({ default: { warn: mocks.warn } }))

import { CHAT_SYNC_INTERVAL_MS, startChatWorker } from '../../server/chat/worker'

test('no Chat sessions means no repeated database or Instagram requests', async () => {
  mocks.watch.mockImplementation(onUpdate => { onUpdate([]); return { initial: Promise.resolve([]), unsubscribe: mocks.unsubscribe } })
  const stop = startChatWorker()
  await vi.advanceTimersByTimeAsync(86_400_000)
  expect(mocks.profilesGetById).not.toHaveBeenCalled()
  expect(mocks.cachedInbox).not.toHaveBeenCalled()
  stop()
  expect(mocks.unsubscribe).toHaveBeenCalled()
})

beforeEach(() => {
  vi.useFakeTimers()
  mocks.profilesGetById.mockReset()
  mocks.watch.mockImplementation(onUpdate => { onUpdate(['active', 'offline', 'deleting']); return { initial: Promise.resolve([]), unsubscribe: mocks.unsubscribe } })
  mocks.cachedInbox.mockReset().mockResolvedValue({})
})

test('Background Chat sync runs without a page, repeats every 15 minutes and stops cleanly', async () => {
  const active = { id: 'active', igLoggedIn: true, status: 'idle' }
  mocks.profilesGetById.mockImplementation(async id => id === 'active' ? active :
    id === 'offline' ? { id, igLoggedIn: false } : { id, igLoggedIn: true, status: 'deleting' })
  const stop = startChatWorker()
  try {
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.cachedInbox.mock.calls).toEqual([[active]])
    await vi.advanceTimersByTimeAsync(CHAT_SYNC_INTERVAL_MS - 1)
    expect(mocks.cachedInbox).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.cachedInbox).toHaveBeenCalledTimes(2)
    stop()
    await vi.advanceTimersByTimeAsync(CHAT_SYNC_INTERVAL_MS)
    expect(mocks.cachedInbox).toHaveBeenCalledTimes(2)
  } finally { stop() }
})

test('Background sync limits concurrency, skips overlapping rounds, and survives a failed profile', async () => {
  mocks.watch.mockImplementation(onUpdate => { onUpdate(['0','1','2','3','4','5']); return { initial: Promise.resolve([]), unsubscribe: mocks.unsubscribe } })
  mocks.profilesGetById.mockImplementation(async id => ({ id, igLoggedIn: true }))
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  mocks.cachedInbox.mockImplementation(() => pending)
  const stop = startChatWorker()
  try {
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.cachedInbox).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(CHAT_SYNC_INTERVAL_MS)
    expect(mocks.profilesGetById).toHaveBeenCalledTimes(4)
    mocks.cachedInbox.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({})
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.cachedInbox).toHaveBeenCalledTimes(6)
    await vi.advanceTimersByTimeAsync(CHAT_SYNC_INTERVAL_MS)
    expect(mocks.cachedInbox).toHaveBeenCalledTimes(12)
  } finally { release(); stop() }
})
