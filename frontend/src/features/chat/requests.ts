import { apiFetch, type ApiFetchOptions } from '@/lib/api'
import { readSharedChatResponse, saveSharedChatResponse } from './cache'

const listeners = new Set<(userId: string, path: string) => void>()
let channel: BroadcastChannel | undefined
export function subscribeChatResponses(
  listener: (userId: string, path: string) => void,
): () => void {
  listeners.add(listener)
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel('ig-bot-chat')
      channel.onmessage = (event) => {
        const value = event.data as { userId?: unknown; path?: unknown }
        if (typeof value?.userId === 'string' && typeof value.path === 'string')
          for (const notify of listeners) notify(value.userId, value.path)
      }
    } catch {
      /* Browser storage restrictions must not block Chat. */
    }
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      channel?.close()
      channel = undefined
    }
  }
}

/** Serialize identical reads across tabs. Aborted followers never cancel another tab's request. */
export async function fetchChatSnapshot<T>(
  userId: string,
  path: string,
  options: ApiFetchOptions,
): Promise<T> {
  const load = async () => {
    options.signal?.throwIfAborted()
    const cached = await readSharedChatResponse<T>(userId, path)
    if (cached) return cached
    const value = await apiFetch<T>(path, options)
    options.signal?.throwIfAborted()
    await saveSharedChatResponse(userId, path, value)
    channel?.postMessage({ userId, path })
    return value
  }
  if (!navigator.locks) return apiFetch<T>(path, options)
  try {
    return await navigator.locks.request(`chat:${userId}:${path}`, { signal: options.signal }, load)
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === 'SecurityError' || error.name === 'NotSupportedError')
    )
      return apiFetch<T>(path, options)
    throw error
  }
}
