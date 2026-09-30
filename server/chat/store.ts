import { getChatCache } from './cache.js'
import type { ChatThread } from './instagram.js'
import { InstagramChat } from './instagram.js'
import { chatUnreadSave } from '../shared/convexClient.js'
import { broadcast } from '../websocket.js'
import logger from '../shared/logger.js'
import { LruMap } from '../shared/lru.js'

const published = new LruMap<string, string>(256)
const publishing = new Map<string, Promise<void>>()

// A failed counter update never blocks messages. The next inbox check retries it.
export async function publishUnread(profileId: string, token: string): Promise<void> {
  while (publishing.has(profileId)) await publishing.get(profileId)
  if (!getChatCache().inbox(profileId).syncedAt) return
  const count = getChatCache().unreadCount(profileId)
  const key = `${token}:${count}`
  if (published.get(profileId) === key) return
  const operation = chatUnreadSave(profileId, token, count)
    .then(() => {
      published.set(profileId, key)
    })
    .catch((error) => {
      logger.error({
        event: 'chat.counter_sync',
        error,
        profileId,
        message: 'Could not sync unread count',
        outcome: 'error',
      })
    })
  publishing.set(profileId, operation)
  try {
    await operation
  } finally {
    if (publishing.get(profileId) === operation) publishing.delete(profileId)
  }
}

export async function chatCacheInbox(profileId: string) {
  if (!(await InstagramChat.hasSession(profileId))) {
    getChatCache().clear(profileId)
    published.delete(profileId)
  }
  return getChatCache().inbox(profileId)
}
export async function chatCacheThread(profileId: string, threadId: string) {
  return getChatCache().thread(profileId, threadId)
}
export async function chatCacheSaveInbox(
  profileId: string,
  token: string,
  inbox: { viewerId: string; threads: ChatThread[] },
  mode: 'full' | 'unread' = 'full',
) {
  const cache = getChatCache()
  const previous = cache.inbox(profileId)
  const saved = cache.saveInbox(profileId, token, inbox, mode)
  if (JSON.stringify(previous.threads) !== JSON.stringify(saved.threads))
    broadcast({ type: 'chat_changed', profileId })
  void publishUnread(profileId, token)
  return saved
}
export async function chatCacheSaveThread(
  profileId: string,
  token: string,
  thread: ChatThread,
  fetchedAt: number,
) {
  const cache = getChatCache()
  const previous = cache.thread(profileId, thread.id)
  const saved = cache.saveThread(profileId, token, thread, fetchedAt)
  if (JSON.stringify(previous) !== JSON.stringify(saved))
    broadcast({ type: 'chat_changed', profileId, threadId: thread.id })
  void publishUnread(profileId, token)
  return saved
}
export async function chatMarkUnsent(
  profileId: string,
  token: string,
  threadId: string,
  messageId: string,
) {
  const profileIds = getChatCache().markUnsent(profileId, token, threadId, messageId)
  for (const id of profileIds) {
    broadcast({ type: 'chat_changed', profileId: id, threadId, messageId })
    const ownerToken = getChatCache().token(id)
    if (ownerToken) void publishUnread(id, ownerToken)
  }
  return { profileIds }
}
