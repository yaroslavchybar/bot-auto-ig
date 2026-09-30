import type { ChatInbox, ChatMessage, ChatThread } from './types'

const DB_NAME = 'ig-bot-chat-cache'
const STORE = 'snapshots'
const MAX_AGE_MS = 30 * 24 * 60 * 60_000
const PENDING_AGE_MS = 24 * 60 * 60_000
const MAX_THREADS_PER_USER = 100
const CLEANUP_INTERVAL_MS = 60 * 60_000
let dbPromise: Promise<IDBDatabase | null> | undefined
const lastCleanup = new Map<string, number>()
type Snapshot<T> = { value: T; updatedAt: number }

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 2)
    let settled = false
    const finish = (db: IDBDatabase | null) => {
      if (settled) {
        db?.close()
        return
      }
      settled = true
      if (!db) dbPromise = undefined
      resolve(db)
    }
    request.onupgradeneeded = () => {
      if (request.result.objectStoreNames.contains(STORE)) request.result.deleteObjectStore(STORE)
      request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        dbPromise = undefined
      }
      finish(db)
    }
    request.onerror = () => finish(null)
    request.onblocked = () => finish(null)
  })
  return dbPromise
}

function scheduleCleanup(userId: string): void {
  if (Date.now() - (lastCleanup.get(userId) ?? 0) < CLEANUP_INTERVAL_MS) return
  lastCleanup.set(userId, Date.now())
  void cleanupUser(userId)
}

async function read<T>(userId: string, key: string, maxAge = MAX_AGE_MS): Promise<T | null> {
  try {
    const db = await openDb()
    if (!db) return null
    return await new Promise<T | null>((resolve) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      request.onsuccess = () => {
        const snapshot = request.result as Snapshot<T> | undefined
        resolve(snapshot && Date.now() - snapshot.updatedAt < maxAge ? snapshot.value : null)
        scheduleCleanup(userId)
      }
      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function write(
  userId: string,
  key: string,
  value: unknown,
  replaceKey?: string,
): Promise<void> {
  try {
    const db = await openDb()
    if (!db) return
    await new Promise<void>((resolve) => {
      const transaction = db.transaction(STORE, 'readwrite')
      const store = transaction.objectStore(STORE)
      if (replaceKey && replaceKey !== key) store.delete(replaceKey)
      store.put({ value, updatedAt: Date.now() } satisfies Snapshot<unknown>, key)
      if (key.startsWith(`${userId}:request:`)) {
        const prefix = `${userId}:request:`
        const records: { key: IDBValidKey; updatedAt: number }[] = []
        const cursorRequest = store.openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`))
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result
          if (!cursor) {
            records.sort((a, b) => b.updatedAt - a.updatedAt)
            for (const old of records.slice(20)) store.delete(old.key)
            return
          }
          const updatedAt = (cursor.value as Snapshot<unknown>).updatedAt
          if (Date.now() - updatedAt >= 60_000) cursor.delete()
          else records.push({ key: cursor.key, updatedAt })
          cursor.continue()
        }
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    })
    scheduleCleanup(userId)
  } catch {
    // Browser storage is optional; network responses remain usable.
  }
}

const inboxKey = (userId: string, profileId: string) => `${userId}:inbox:${profileId}`
const threadKey = (userId: string, profileId: string, threadId: string) =>
  `${userId}:thread:${profileId}:${threadId}`
const pendingPrefix = (userId: string, profileId: string, threadId: string) =>
  `${userId}:pending:${profileId}:${threadId}:`
const pendingKey = (userId: string, profileId: string, threadId: string, messageId: string) =>
  `${pendingPrefix(userId, profileId, threadId)}${messageId}`

export async function readInboxCache(userId: string, profileId: string): Promise<ChatInbox | null> {
  const value = await read<ChatInbox>(userId, inboxKey(userId, profileId))
  return value && typeof value.viewerId === 'string' && Array.isArray(value.threads) ? value : null
}
export const saveInboxCache = (userId: string, profileId: string, inbox: ChatInbox) =>
  write(userId, inboxKey(userId, profileId), inbox)
export async function readThreadCache(
  userId: string,
  profileId: string,
  threadId: string,
): Promise<ChatThread | null> {
  const value = await read<ChatThread>(userId, threadKey(userId, profileId, threadId))
  return value?.id === threadId && Array.isArray(value.messages) ? value : null
}
export const saveThreadCache = (
  userId: string,
  profileId: string,
  threadId: string,
  thread: ChatThread,
) =>
  write(userId, threadKey(userId, profileId, threadId), {
    ...thread,
    messages: thread.messages.slice(0, 30),
  })

export const savePendingChatMessage = (
  userId: string,
  profileId: string,
  threadId: string,
  message: ChatMessage,
) => write(userId, pendingKey(userId, profileId, threadId, message.id), message)

export const replacePendingChatMessage = (
  userId: string,
  profileId: string,
  threadId: string,
  oldId: string,
  message: ChatMessage,
) =>
  write(
    userId,
    pendingKey(userId, profileId, threadId, message.id),
    message,
    pendingKey(userId, profileId, threadId, oldId),
  )

export async function readPendingChatMessages(
  userId: string,
  profileId: string,
  threadId: string,
): Promise<ChatMessage[]> {
  try {
    const db = await openDb()
    if (!db) return []
    const prefix = pendingPrefix(userId, profileId, threadId)
    return await new Promise<ChatMessage[]>((resolve) => {
      const messages: ChatMessage[] = []
      const request = db
        .transaction(STORE, 'readonly')
        .objectStore(STORE)
        .openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`))
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve(messages)
          scheduleCleanup(userId)
          return
        }
        const snapshot = cursor.value as Snapshot<ChatMessage>
        if (Date.now() - snapshot.updatedAt < PENDING_AGE_MS && snapshot.value?.id)
          messages.push(snapshot.value)
        cursor.continue()
      }
      request.onerror = () => resolve(messages)
    })
  } catch {
    return []
  }
}

export const clearPendingChatMessage = (
  userId: string,
  profileId: string,
  threadId: string,
  messageId: string,
) => removeMatching((key) => key === pendingKey(userId, profileId, threadId, messageId))

export const clearThreadChatCache = (userId: string, threadId: string) =>
  removeMatching(
    (key) =>
      key.startsWith(`${userId}:inbox:`) ||
      (key.startsWith(`${userId}:thread:`) && key.endsWith(`:${threadId}`)),
  )

async function cleanupUser(userId: string): Promise<void> {
  try {
    const db = await openDb()
    if (!db) return
    await new Promise<void>((resolve) => {
      const transaction = db.transaction(STORE, 'readwrite')
      const store = transaction.objectStore(STORE)
      const threads: { key: string; updatedAt: number }[] = []
      const request = store.openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          threads.sort((a, b) => b.updatedAt - a.updatedAt)
          for (const old of threads.slice(MAX_THREADS_PER_USER)) store.delete(old.key)
          return
        }
        if (typeof cursor.key === 'string' && cursor.key.startsWith(`${userId}:`)) {
          const updatedAt = (cursor.value as Snapshot<unknown>).updatedAt
          const maxAge = cursor.key.startsWith(`${userId}:request:`)
            ? 60_000
            : cursor.key.startsWith(`${userId}:pending:`)
              ? PENDING_AGE_MS
              : MAX_AGE_MS
          if (!Number.isFinite(updatedAt) || Date.now() - updatedAt >= maxAge) cursor.delete()
          else if (cursor.key.startsWith(`${userId}:thread:`))
            threads.push({ key: cursor.key, updatedAt })
        }
        cursor.continue()
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    })
  } catch {
    // Browser storage is optional.
  }
}

async function removeMatching(predicate: (key: string) => boolean): Promise<void> {
  try {
    const db = await openDb()
    if (!db) return
    await new Promise<void>((resolve) => {
      const transaction = db.transaction(STORE, 'readwrite')
      const store = transaction.objectStore(STORE)
      const request = store.openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        if (typeof cursor.key === 'string' && predicate(cursor.key)) cursor.delete()
        cursor.continue()
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    })
  } catch {
    // Cache clearing should not block signing out or disconnecting Chat.
  }
}

export const clearProfileChatCache = (userId: string, profileId: string) =>
  removeMatching(
    (key) =>
      key === inboxKey(userId, 'all') ||
      key === inboxKey(userId, profileId) ||
      key.startsWith(`${userId}:thread:${profileId}:`) ||
      key.startsWith(`${userId}:pending:${profileId}:`) ||
      key.startsWith(`${userId}:request:`),
  )

export const clearUserChatCache = (userId: string) =>
  removeMatching((key) => key.startsWith(`${userId}:`)).then(() => {
    lastCleanup.delete(userId)
  })

// Short-lived responses let tabs reuse a fetch under a browser lock without keeping histories in RAM.
export const readSharedChatResponse = <T>(userId: string, key: string) =>
  read<T>(userId, `${userId}:request:${key}`, 10_000)
export const saveSharedChatResponse = (userId: string, key: string, value: unknown) =>
  write(userId, `${userId}:request:${key}`, value)
export const clearSharedChatResponses = (userId: string) =>
  removeMatching((key) => key.startsWith(`${userId}:request:`))
