import { Database } from 'bun:sqlite'
import { mkdirSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { resolveProjectRoot } from '../shared/utils.js'
import type { ChatMessage, ChatThread } from './instagram.js'

export type CachedChatInbox = {
  connected: boolean
  viewerId: string
  threads: ChatThread[]
  syncedAt: number
}
export type CachedChatThread = ChatThread & { syncedAt: number }
type Session = { token: string; viewerId: string; ids: string[]; syncedAt: number }
type Thread = CachedChatThread & {
  preview?: ChatMessage
  previewUpdatedAt: number
  lastIncomingAt: number
  repliedThroughAt: number
  unsentMessageIds: string[]
}
const MAX_THREADS = 200
const MAX_AGE_MS = 30 * 24 * 60 * 60_000

function mergeMessages(previous: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const messages = new Map(previous.map((item) => [item.id, item]))
  for (const item of incoming) messages.set(item.id, item)
  return [...messages.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, 30)
}
function mergeSeen(previous: ChatThread['lastSeenAt'], incoming: ChatThread['lastSeenAt']) {
  const seen = new Map(previous.map((item) => [item.userId, item.timestamp]))
  for (const item of incoming)
    seen.set(item.userId, Math.max(seen.get(item.userId) ?? 0, item.timestamp))
  return [...seen].map(([userId, timestamp]) => ({ userId, timestamp }))
}
function watermarks(existing: Thread | null, messages: ChatMessage[], viewerId: string) {
  const lastIncomingAt = Math.max(
    existing?.lastIncomingAt ?? 0,
    ...messages
      .filter((item) => viewerId && item.senderId && item.senderId !== viewerId)
      .map((item) => item.timestamp),
  )
  const repliedThroughAt = Math.max(
    existing?.repliedThroughAt ?? 0,
    ...messages
      .filter((item) => viewerId && item.senderId === viewerId)
      .map((item) => item.timestamp),
  )
  return { lastIncomingAt, repliedThroughAt, unread: lastIncomingAt > repliedThroughAt }
}
function publicThread(row: Thread): CachedChatThread {
  return {
    id: row.id,
    title: row.title,
    users: row.users,
    messages: mergeMessages(row.messages, row.preview ? [row.preview] : []),
    lastSeenAt: row.lastSeenAt,
    unread: row.unread ?? false,
    confirmedMessageIds: row.confirmedMessageIds,
    syncedAt: row.syncedAt,
  }
}

/** Disk-backed, bounded cache shared by all devices. Instagram remains the source of truth. */
export class ChatCache {
  private readonly db: Database
  constructor(filename: string) {
    this.db = new Database(filename, { create: true, strict: true })
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA cache_size=-2048; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sessions (profileId TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS threads (profileId TEXT NOT NULL REFERENCES sessions(profileId) ON DELETE CASCADE,
        threadId TEXT NOT NULL, value TEXT NOT NULL, updatedAt INTEGER NOT NULL,
        PRIMARY KEY(profileId, threadId));
      CREATE INDEX IF NOT EXISTS threads_by_id ON threads(threadId);
      CREATE INDEX IF NOT EXISTS threads_by_age ON threads(updatedAt);`)
  }
  close(): void {
    this.db.close()
  }
  private session(profileId: string): Session | null {
    const row = this.db
      .query<{ value: string }, [string]>('SELECT value FROM sessions WHERE profileId=?')
      .get(profileId)
    return row ? (JSON.parse(row.value) as Session) : null
  }
  private saveSession(profileId: string, value: Session): void {
    const json = JSON.stringify(value)
    this.db
      .query(
        'INSERT INTO sessions VALUES (?, ?) ON CONFLICT(profileId) DO UPDATE SET value=excluded.value WHERE value<>excluded.value',
      )
      .run(profileId, json)
  }
  connect(profileId: string, token: string, viewerId = ''): void {
    this.db.transaction(() => {
      const old = this.session(profileId)
      if (old?.token === token) {
        if (viewerId && !old.viewerId) this.saveSession(profileId, { ...old, viewerId })
        return
      }
      this.clear(profileId)
      this.saveSession(profileId, { token, viewerId, ids: [], syncedAt: 0 })
    })()
  }
  clear(profileId: string): void {
    this.db.query('DELETE FROM sessions WHERE profileId=?').run(profileId)
  }
  token(profileId: string): string | undefined {
    return this.session(profileId)?.token
  }
  retainProfiles(ids: string[]): void {
    const keep = new Set(ids)
    const rows = this.db.query<{ profileId: string }, []>('SELECT profileId FROM sessions').all()
    this.db.transaction(() => {
      for (const row of rows) if (!keep.has(row.profileId)) this.clear(row.profileId)
    })()
  }
  private requireSession(profileId: string, token: string): Session {
    const session = this.session(profileId)
    if (!session || session.token !== token) throw new Error('Chat session changed')
    return session
  }
  private row(profileId: string, threadId: string): Thread | null {
    const row = this.db
      .query<{ value: string }, [string, string]>(
        'SELECT value FROM threads WHERE profileId=? AND threadId=?',
      )
      .get(profileId, threadId)
    return row ? (JSON.parse(row.value) as Thread) : null
  }
  private put(profileId: string, row: Thread): void {
    this.db
      .query(`INSERT INTO threads VALUES (?, ?, ?, ?) ON CONFLICT(profileId, threadId)
      DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt WHERE value<>excluded.value`)
      .run(profileId, row.id, JSON.stringify(row), Date.now())
  }
  private prune(profileId: string): void {
    this.db
      .query(`DELETE FROM threads WHERE profileId=? AND (updatedAt<? OR threadId IN
      (SELECT threadId FROM threads WHERE profileId=? ORDER BY updatedAt DESC, threadId LIMIT -1 OFFSET ?))`)
      .run(profileId, Date.now() - MAX_AGE_MS, profileId, MAX_THREADS)
  }
  inbox(profileId: string): CachedChatInbox {
    const session = this.session(profileId)
    if (!session) return { connected: false, viewerId: '', threads: [], syncedAt: 0 }
    const threads = session.ids
      .flatMap((id) => {
        const row = this.row(profileId, id)
        return row
          ? [
              {
                id: row.id,
                title: row.title,
                users: row.users,
                messages: row.preview ? [row.preview] : [],
                lastSeenAt: row.lastSeenAt,
                unread: row.unread ?? false,
              },
            ]
          : []
      })
      .sort((a, b) => (b.messages[0]?.timestamp ?? 0) - (a.messages[0]?.timestamp ?? 0))
    return { connected: true, viewerId: session.viewerId, threads, syncedAt: session.syncedAt }
  }
  thread(profileId: string, id: string): CachedChatThread | null {
    const row = this.row(profileId, id)
    return row ? publicThread(row) : null
  }
  unreadCount(profileId: string): number {
    return (
      this.db
        .query<{ count: number }, [string]>(
          "SELECT COUNT(*) AS count FROM threads WHERE profileId=? AND json_extract(value, '$.unread')=1",
        )
        .get(profileId)?.count ?? 0
    )
  }
  saveInbox(
    profileId: string,
    token: string,
    inbox: { viewerId: string; threads: ChatThread[] },
    mode: 'full' | 'unread' = 'full',
  ): CachedChatInbox {
    return this.db.transaction(() => {
      const session = this.requireSession(profileId, token)
      const previous = this.inbox(profileId)
      for (const item of inbox.threads.slice(0, MAX_THREADS)) {
        if (item.messages.length > 1) throw new Error('Inbox needs only one preview per thread')
        const old = this.row(profileId, item.id)
        const unsent = new Set(old?.unsentMessageIds ?? [])
        const preview =
          item.messages[0] && !unsent.has(item.messages[0].id)
            ? item.messages[0]
            : item.messages.length
              ? old?.preview
              : undefined
        this.put(profileId, {
          ...old,
          ...item,
          messages: old?.messages ?? [],
          ...watermarks(old, preview ? [preview] : [], inbox.viewerId),
          preview,
          previewUpdatedAt:
            JSON.stringify(old?.preview) === JSON.stringify(preview)
              ? (old?.previewUpdatedAt ?? 0)
              : Date.now(),
          lastSeenAt: mergeSeen(old?.lastSeenAt ?? [], item.lastSeenAt),
          syncedAt: old?.syncedAt ?? 0,
          confirmedMessageIds: old?.confirmedMessageIds,
          unsentMessageIds: old?.unsentMessageIds ?? [],
        })
      }
      const incomingIds = inbox.threads.map((item) => item.id)
      const ids = [
        ...new Set(mode === 'unread' ? [...incomingIds, ...session.ids] : incomingIds),
      ].slice(0, MAX_THREADS)
      // Freshness is tracked in memory; unchanged inboxes never rewrite disk or Convex.
      this.saveSession(profileId, {
        ...session,
        ids,
        viewerId: inbox.viewerId,
        syncedAt: session.syncedAt,
      })
      const changed =
        JSON.stringify(previous.threads) !== JSON.stringify(this.inbox(profileId).threads) ||
        previous.viewerId !== inbox.viewerId
      this.saveSession(profileId, {
        ...session,
        ids,
        viewerId: inbox.viewerId,
        syncedAt: changed || !session.syncedAt ? Date.now() : session.syncedAt,
      })
      this.prune(profileId)
      return this.inbox(profileId)
    })()
  }
  saveThread(profileId: string, token: string, item: ChatThread, fetchedAt = 0): CachedChatThread {
    return this.db.transaction(() => {
      const session = this.requireSession(profileId, token)
      if (item.messages.length > 100) throw new Error('Too many Chat messages')
      const old = this.row(profileId, item.id)
      const unsent = new Set(old?.unsentMessageIds ?? [])
      const incoming = item.messages.filter((message) => !unsent.has(message.id))
      const confirmedMessageIds = incoming.map((message) => message.id).sort()
      const fetched =
        incoming.length || item.messages.length === 0
          ? incoming.length
            ? mergeMessages(
                (old?.messages ?? []).filter(
                  (message) =>
                    message.timestamp < Math.min(...incoming.map((value) => value.timestamp)),
                ),
                incoming,
              )
            : []
          : (old?.messages ?? []).filter((message) => !unsent.has(message.id))
      const latest = fetched[0]
      const newer =
        old?.preview &&
        old.previewUpdatedAt > fetchedAt &&
        (old.preview.timestamp > (latest?.timestamp ?? -Infinity) ||
          (old.preview.id === latest?.id && old.preview.timestamp === latest.timestamp))
          ? old.preview
          : undefined
      const messages = newer ? mergeMessages(fetched, [newer]) : fetched
      const row: Thread = {
        ...old,
        ...item,
        messages,
        confirmedMessageIds,
        ...watermarks(old, messages, session.viewerId),
        preview: messages[0],
        previewUpdatedAt:
          JSON.stringify(old?.preview) === JSON.stringify(messages[0])
            ? (old?.previewUpdatedAt ?? 0)
            : Date.now(),
        lastSeenAt: mergeSeen(old?.lastSeenAt ?? [], item.lastSeenAt),
        syncedAt: old?.syncedAt ?? 0,
        unsentMessageIds: old?.unsentMessageIds ?? [],
      }
      if (
        !old ||
        JSON.stringify(publicThread(row)) !== JSON.stringify(publicThread(old)) ||
        row.lastIncomingAt !== old.lastIncomingAt ||
        row.repliedThroughAt !== old.repliedThroughAt
      )
        row.syncedAt = Date.now()
      this.put(profileId, row)
      this.prune(profileId)
      return publicThread(row)
    })()
  }
  markUnsent(profileId: string, token: string, threadId: string, messageId: string): string[] {
    return this.db.transaction(() => {
      this.requireSession(profileId, token)
      const rows = this.db
        .query<{ profileId: string; value: string }, [string]>(
          'SELECT profileId, value FROM threads WHERE threadId=?',
        )
        .all(threadId)
      if (!rows.some((row) => row.profileId === profileId)) {
        this.saveThread(profileId, token, {
          id: threadId,
          title: 'Conversation',
          users: [],
          messages: [],
          lastSeenAt: [],
        })
        rows.push({ profileId, value: JSON.stringify(this.row(profileId, threadId)) })
      }
      for (const owner of rows) {
        const row = JSON.parse(owner.value) as Thread
        const session = this.session(owner.profileId)!
        const removed =
          row.messages.find((message) => message.id === messageId) ??
          (row.preview?.id === messageId ? row.preview : undefined)
        row.messages = row.messages.filter((message) => message.id !== messageId)
        row.confirmedMessageIds = row.confirmedMessageIds?.filter((id) => id !== messageId)
        if (row.preview?.id === messageId) {
          row.preview = row.messages[0]
          row.previewUpdatedAt = Date.now()
        }
        const remaining = mergeMessages(row.messages, row.preview ? [row.preview] : [])
        if (removed?.senderId !== session.viewerId && removed?.timestamp === row.lastIncomingAt)
          row.lastIncomingAt = Math.max(
            0,
            ...remaining
              .filter((message) => message.senderId !== session.viewerId)
              .map((message) => message.timestamp),
          )
        if (removed?.senderId === session.viewerId && removed?.timestamp === row.repliedThroughAt)
          row.repliedThroughAt = Math.max(
            0,
            ...remaining
              .filter((message) => message.senderId === session.viewerId)
              .map((message) => message.timestamp),
          )
        row.unread = row.lastIncomingAt > row.repliedThroughAt
        row.unsentMessageIds = [...new Set([...row.unsentMessageIds, messageId])].slice(-100)
        this.put(owner.profileId, row)
      }
      return rows.map((row) => row.profileId)
    })()
  }
}

let cache: ChatCache | undefined
export function getChatCache(): ChatCache {
  if (!cache) {
    const directory = path.join(resolveProjectRoot(import.meta.url), 'data', 'chat-cache')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const filename = path.join(directory, 'cache.sqlite')
    cache = new ChatCache(filename)
    chmodSync(filename, 0o600)
  }
  return cache
}
