import { Blob as NodeBlob } from 'node:buffer'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { beforeEach, afterEach, expect, test, vi } from 'vite-plus/test'
import { apiFetchBlob } from '@/lib/api'

vi.mock('@/lib/api', () => ({ apiFetchBlob: vi.fn() }))
beforeEach(() => {
  vi.resetModules()
  vi.mocked(apiFetchBlob).mockReset()
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  vi.stubGlobal('Blob', NodeBlob)
})
afterEach(() => vi.unstubAllGlobals())
const photo = () => new Blob(['photo'], { type: 'image/webp' })

test('picture blobs survive module reloads and remain scoped to user/profile', async () => {
  let cache = await import('@/features/chat/cache')
  await cache.saveChatAvatar('user', 'profile', '42', photo())
  vi.resetModules()
  cache = await import('@/features/chat/cache')
  expect(await (await cache.readChatAvatar('user', 'profile', '42'))?.text()).toBe('photo')
  expect(await cache.readChatAvatar('other', 'profile', '42')).toBeNull()
  expect(await cache.readChatAvatar('user', 'other', '42')).toBeNull()
})

test('picture cache is bounded, expires, and rejects oversized or non-image data', async () => {
  const cache = await import('@/features/chat/cache')
  let now = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  for (let id = 0; id <= 200; id++) {
    now++
    await cache.saveChatAvatar('user', 'profile', String(id), photo())
  }
  expect(await cache.readChatAvatar('user', 'profile', '0')).toBeNull()
  expect(await cache.readChatAvatar('user', 'profile', '200')).not.toBeNull()
  await cache.saveChatAvatar(
    'user',
    'profile',
    'invalid',
    new Blob(['html'], { type: 'text/html' }),
  )
  await cache.saveChatAvatar(
    'user',
    'profile',
    'large',
    new Blob([new Uint8Array(256 * 1024 + 1)], { type: 'image/webp' }),
  )
  expect(await cache.readChatAvatar('user', 'profile', 'invalid')).toBeNull()
  expect(await cache.readChatAvatar('user', 'profile', 'large')).toBeNull()
  now += 30 * 24 * 60 * 60_000
  expect(await cache.readChatAvatar('user', 'profile', '200')).toBeNull()
})

test('clearing a profile or user also removes their picture blobs', async () => {
  const cache = await import('@/features/chat/cache')
  for (const [user, profile] of [
    ['user', 'one'],
    ['user', 'two'],
    ['other', 'one'],
  ])
    await cache.saveChatAvatar(user, profile, '42', photo())
  await cache.clearProfileChatCache('user', 'one')
  expect(await cache.readChatAvatar('user', 'one', '42')).toBeNull()
  expect(await cache.readChatAvatar('user', 'two', '42')).not.toBeNull()
  await cache.clearUserChatCache('user')
  expect(await cache.readChatAvatar('user', 'two', '42')).toBeNull()
  expect(await cache.readChatAvatar('other', 'one', '42')).not.toBeNull()
})

test('list/header share one download and subsequent loads use the device cache', async () => {
  const { loadChatAvatar } = await import('@/features/chat/avatar')
  let resolve!: (blob: Blob) => void
  vi.mocked(apiFetchBlob).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const signal = new AbortController().signal
  const loads = [
    loadChatAvatar('user', 'profile', '42', signal),
    loadChatAvatar('user', 'profile', '42', signal),
  ]
  await vi.waitFor(() => expect(apiFetchBlob).toHaveBeenCalledTimes(1))
  resolve(photo())
  await Promise.all(loads)
  expect(await (await loadChatAvatar('user', 'profile', '42', signal)).text()).toBe('photo')
  expect(apiFetchBlob).toHaveBeenCalledTimes(1)
})

test('opening chat refreshes pictures after 24 hours while showing the cached picture', async () => {
  const cache = await import('@/features/chat/cache')
  const { loadChatAvatar } = await import('@/features/chat/avatar')
  let now = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  await cache.saveChatAvatar('user', 'profile', '42', photo())
  const signal = new AbortController().signal
  now += cache.AVATAR_REFRESH_MS - 1
  expect(await (await loadChatAvatar('user', 'profile', '42', signal)).text()).toBe('photo')
  expect(apiFetchBlob).not.toHaveBeenCalled()
  now++
  let resolve!: (blob: Blob) => void
  vi.mocked(apiFetchBlob).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const showCached = vi.fn()
  const refresh = loadChatAvatar('user', 'profile', '42', signal, showCached)
  await vi.waitFor(() => expect(showCached).toHaveBeenCalledTimes(1))
  expect(await showCached.mock.calls[0][0].text()).toBe('photo')
  resolve(new Blob(['new photo'], { type: 'image/webp' }))
  expect(await (await refresh).text()).toBe('new photo')
  expect(await (await loadChatAvatar('user', 'profile', '42', signal)).text()).toBe('new photo')
  expect(apiFetchBlob).toHaveBeenCalledTimes(1)
})

test('failed refreshes retain the cached picture and retry on the next open', async () => {
  const cache = await import('@/features/chat/cache')
  const { loadChatAvatar } = await import('@/features/chat/avatar')
  let now = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  await cache.saveChatAvatar('user', 'profile', '42', photo())
  now += cache.AVATAR_REFRESH_MS
  vi.mocked(apiFetchBlob).mockRejectedValue(new Error('Offline'))
  const signal = new AbortController().signal
  expect(await (await loadChatAvatar('user', 'profile', '42', signal)).text()).toBe('photo')
  expect(await cache.readChatAvatar('user', 'profile', '42', cache.AVATAR_REFRESH_MS)).toBeNull()
  expect(await (await loadChatAvatar('user', 'profile', '42', signal)).text()).toBe('photo')
  expect(apiFetchBlob).toHaveBeenCalledTimes(2)
})

test('one cancelled consumer does not cancel another, and unavailable storage does not block pictures', async () => {
  vi.stubGlobal('indexedDB', undefined)
  const { loadChatAvatar } = await import('@/features/chat/avatar')
  let resolve!: (blob: Blob) => void
  vi.mocked(apiFetchBlob).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const cancelled = new AbortController()
  const first = loadChatAvatar('user', 'profile', '42', cancelled.signal)
  const second = loadChatAvatar('user', 'profile', '42', new AbortController().signal)
  await vi.waitFor(() => expect(apiFetchBlob).toHaveBeenCalledTimes(1))
  cancelled.abort()
  resolve(photo())
  await expect(first).rejects.toThrow()
  expect(await (await second).text()).toBe('photo')
})
