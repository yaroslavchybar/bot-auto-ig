import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { fetchChatSnapshot, subscribeChatResponses } from '@/features/chat/requests'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  values: new Map<string, unknown>(),
}))
vi.mock('@/lib/api', () => ({ apiFetch: mocks.fetch }))
vi.mock('@/features/chat/cache', () => ({
  readSharedChatResponse: async (userId: string, key: string) =>
    mocks.values.get(`${userId}:${key}`) ?? null,
  saveSharedChatResponse: async (userId: string, key: string, value: unknown) => {
    mocks.values.set(`${userId}:${key}`, value)
  },
}))

beforeEach(() => {
  mocks.values.clear()
  mocks.fetch.mockReset().mockResolvedValue({ messages: ['hello'] })
  const pending = new Map<string, Promise<unknown>>()
  vi.stubGlobal('navigator', {
    locks: {
      request: async (
        key: string,
        options: { signal?: AbortSignal },
        load: () => Promise<unknown>,
      ) => {
        const previous = pending.get(key)
        const next = (async () => {
          await previous
          options.signal?.throwIfAborted()
          return load()
        })()
        pending.set(
          key,
          next.catch(() => {}),
        )
        return next
      },
    },
  })
})
afterEach(() => vi.unstubAllGlobals())

test('simultaneous tabs fetch once and users have separate caches', async () => {
  const [one, two] = await Promise.all([
    fetchChatSnapshot('user', '/threads/1', {}),
    fetchChatSnapshot('user', '/threads/1', {}),
  ])
  expect(one).toEqual(two)
  expect(mocks.fetch).toHaveBeenCalledTimes(1)
  await fetchChatSnapshot('other', '/threads/1', {})
  expect(mocks.fetch).toHaveBeenCalledTimes(2)
})

test('an aborted follower does not cancel the leader', async () => {
  let resolve!: (value: unknown) => void
  mocks.fetch.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const leader = fetchChatSnapshot('user', '/threads/1', {})
  const controller = new AbortController()
  const follower = fetchChatSnapshot('user', '/threads/1', { signal: controller.signal })
  const rejection = expect(follower).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1))
  controller.abort()
  resolve({ messages: ['hello'] })
  expect(await leader).toEqual({ messages: ['hello'] })
  await rejection
  expect(mocks.fetch).toHaveBeenCalledTimes(1)
})

test('abandoned responses are not written; network errors release the lock for retry', async () => {
  const controller = new AbortController()
  mocks.fetch.mockImplementationOnce(async () => {
    controller.abort()
    return { stale: true }
  })
  await expect(
    fetchChatSnapshot('user', '/threads/1', { signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(mocks.values.size).toBe(0)
  mocks.fetch.mockRejectedValueOnce(new Error('network failed'))
  await expect(fetchChatSnapshot('user', '/threads/1', {})).rejects.toThrow('network failed')
  expect(await fetchChatSnapshot('user', '/threads/1', {})).toEqual({ messages: ['hello'] })
})

test('storage restrictions and unavailable locks leave direct fetching usable', async () => {
  vi.stubGlobal('navigator', {})
  expect(await fetchChatSnapshot('user', '/threads/1', {})).toEqual({ messages: ['hello'] })
  vi.stubGlobal('navigator', {
    locks: { request: () => Promise.reject(new DOMException('blocked', 'SecurityError')) },
  })
  expect(await fetchChatSnapshot('user', '/threads/1', {})).toEqual({ messages: ['hello'] })
})

test('tab notifications contain only cache keys and channels close with their last listener', async () => {
  const postMessage = vi.fn()
  const close = vi.fn()
  const received = vi.fn()
  let channel!: { onmessage: ((event: { data: unknown }) => void) | null }
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      onmessage: ((event: { data: unknown }) => void) | null = null
      postMessage = postMessage
      close = close
      constructor() {
        channel = { onmessage: (event) => this.onmessage?.(event) }
      }
    },
  )
  const unsubscribe = subscribeChatResponses(received)
  await fetchChatSnapshot('user', '/threads/1', {})
  expect(postMessage).toHaveBeenCalledWith({ userId: 'user', path: '/threads/1' })
  channel.onmessage?.({ data: { userId: 'user', path: '/threads/1' } })
  expect(received).toHaveBeenCalledWith('user', '/threads/1')
  unsubscribe()
  expect(close).toHaveBeenCalledTimes(1)
})
