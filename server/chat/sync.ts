import { chatCacheInbox, chatCacheSaveInbox, chatCacheSaveThread, chatCacheThread } from '../shared/convexClient.js';
import type { DbProfileRow, CachedChatInbox } from '../shared/convexClient.js';
import { InstagramChat } from './instagram.js';
import type { ChatThread } from './instagram.js';
const INBOX_STALE_MS = 60_000;
const THREAD_STALE_MS = 20_000;
const SYNC_RETRY_MS = 120_000;
const MAX_CACHED_THREADS = 100;
type InboxMode = 'full' | 'unread';
const inboxSyncs = new Map<string, { mode: InboxMode; promise: Promise<CachedChatInbox> }>();
export const threadSyncs = new Map<string, Promise<ChatThread>>();
const inboxSnapshots = new Map<string, { value: CachedChatInbox; checkedAt: number }>();
const threadSnapshots = new Map<string, { value: ChatThread & { syncedAt: number }; checkedAt: number }>();
const inboxFingerprints = new Map<string, string>();
const threadFingerprints = new Map<string, string>();
const syncFailures = new Map<string, { until: number; error: unknown }>();
const cacheVersions = new Map<string, number>();

function cacheVersion(profileId: string): number { return cacheVersions.get(profileId) ?? 0; }

export function invalidateChatSnapshots(profileId: string, threadId?: string): void {
  cacheVersions.set(profileId, cacheVersion(profileId) + 1);
  inboxSnapshots.delete(profileId);
  if (threadId) {
    threadSnapshots.delete(`${profileId}:${threadId}`);
    threadFingerprints.delete(`${profileId}:${threadId}`);
  }
}

function rememberThread(key: string, value: ChatThread & { syncedAt: number }, checkedAt: number): void {
  threadSnapshots.delete(key);
  threadSnapshots.set(key, { value, checkedAt });
  if (threadSnapshots.size > MAX_CACHED_THREADS) {
    const oldest = threadSnapshots.keys().next().value;
    if (oldest) {
      threadSnapshots.delete(oldest);
      threadFingerprints.delete(oldest);
    }
  }
}

function sameThread(left: ChatThread, right: ChatThread): boolean {
  return JSON.stringify([left.title, left.users, left.messages, left.lastSeenAt]) ===
    JSON.stringify([right.title, right.users, right.messages, right.lastSeenAt]);
}

function sameInbox(cached: CachedChatInbox, incoming: { viewerId: string; threads: ChatThread[] },
  mode: InboxMode): boolean {
  if (cached.viewerId !== incoming.viewerId ||
    (mode === 'full' && cached.threads.length !== incoming.threads.length)) return false;
  const previous = new Map(cached.threads.map(thread => [thread.id, thread]));
  return incoming.threads.every(thread => {
    const old = previous.get(thread.id);
    return old && sameThread(old, thread);
  });
}

export function clearSyncFailures(profileId: string): void {
  cacheVersions.set(profileId, cacheVersion(profileId) + 1);
  for (const key of syncFailures.keys()) {
    if (key === `inbox:${profileId}` || key.startsWith(`thread:${profileId}:`)) syncFailures.delete(key);
  }
  inboxSnapshots.delete(profileId);
  for (const key of inboxFingerprints.keys()) if (key.startsWith(`${profileId}:`)) inboxFingerprints.delete(key);
  for (const key of threadSnapshots.keys()) if (key.startsWith(`${profileId}:`)) threadSnapshots.delete(key);
  for (const key of threadFingerprints.keys()) if (key.startsWith(`${profileId}:`)) threadFingerprints.delete(key);
}

async function syncInbox(profile: DbProfileRow, mode: InboxMode, cached: CachedChatInbox,
  persistUnchanged: boolean): Promise<CachedChatInbox> {
  const pending = inboxSyncs.get(profile.id);
  if (pending) {
    if (mode === 'unread' || pending.mode === 'full') {
      const result = await pending.promise;
      if (!persistUnchanged) return result;
    } else {
      await pending.promise.catch(() => {});
    }
    return syncInbox(profile, mode, inboxSnapshots.get(profile.id)?.value ?? cached, persistUnchanged);
  }
  const operation = (async () => {
    try {
      const version = cacheVersion(profile.id);
      const chat = await InstagramChat.load(profile);
      const inbox = await chat.inbox(mode === 'unread');
      if (version !== cacheVersion(profile.id)) return chatCacheInbox(profile.id);
      const key = `${profile.id}:${mode}`;
      const fingerprint = JSON.stringify([chat.cacheToken, inbox]);
      if (!persistUnchanged && cached.syncedAt &&
        (inboxFingerprints.get(key) === fingerprint || sameInbox(cached, inbox, mode))) {
        if (version !== cacheVersion(profile.id)) return chatCacheInbox(profile.id);
        inboxFingerprints.set(key, fingerprint);
        inboxSnapshots.set(profile.id, { value: cached, checkedAt: Date.now() });
        syncFailures.delete(`inbox:${profile.id}`);
        return cached;
      }
      const saved = await chatCacheSaveInbox(profile.id, chat.cacheToken, inbox, mode);
      if (version !== cacheVersion(profile.id)) return chatCacheInbox(profile.id);
      inboxFingerprints.set(key, fingerprint);
      inboxSnapshots.set(profile.id, { value: saved, checkedAt: Date.now() });
      syncFailures.delete(`inbox:${profile.id}`);
      return saved;
    } catch (error) {
      syncFailures.set(`inbox:${profile.id}`, { until: Date.now() + SYNC_RETRY_MS, error });
      throw error;
    }
  })();
  inboxSyncs.set(profile.id, { mode, promise: operation });
  try { return await operation; }
  finally { if (inboxSyncs.get(profile.id)?.promise === operation) inboxSyncs.delete(profile.id); }
}

export async function cachedInbox(profile: DbProfileRow, force = false,
  persistUnchanged = false): Promise<CachedChatInbox> {
  const recent = inboxSnapshots.get(profile.id);
  // The worker reads Convex directly, and a disconnected snapshot is retried so external imports appear.
  const snapshot = persistUnchanged || (recent && !recent.value.connected &&
    Date.now() - recent.checkedAt >= INBOX_STALE_MS) ? undefined : recent;
  const cached = snapshot?.value ?? await chatCacheInbox(profile.id);
  if (!snapshot) inboxSnapshots.set(profile.id, { value: cached, checkedAt: cached.syncedAt || Date.now() });
  if (!cached.connected) return cached;
  if (!force && cached.syncedAt && Date.now() - (snapshot?.checkedAt ?? cached.syncedAt) < INBOX_STALE_MS) return cached;
  const failure = syncFailures.get(`inbox:${profile.id}`);
  if (!force && failure && Date.now() < failure.until) {
    if (cached.syncedAt) return cached;
    throw failure.error;
  }
  const version = cacheVersion(profile.id);
  try { return await syncInbox(profile, cached.syncedAt ? 'unread' : 'full', cached, persistUnchanged); }
  catch (error) {
    if (version !== cacheVersion(profile.id)) return chatCacheInbox(profile.id);
    if (cached.syncedAt) return cached;
    throw error;
  }
}

export async function syncThread(profile: DbProfileRow, id: string): Promise<ChatThread> {
  const key = `${profile.id}:${id}`;
  const pending = threadSyncs.get(key);
  if (pending) return pending;
  const operation = (async () => {
    try {
      const version = cacheVersion(profile.id);
      const chat = await InstagramChat.load(profile);
      const thread = await chat.conversation(id);
      if (version !== cacheVersion(profile.id)) {
        const latest = await chatCacheThread(profile.id, id);
        if (!latest) throw new Error('Chat conversation is missing');
        return latest;
      }
      const fingerprint = JSON.stringify([chat.cacheToken, thread]);
      const snapshot = threadSnapshots.get(key);
      if (version === cacheVersion(profile.id) && snapshot &&
        (threadFingerprints.get(key) === fingerprint || sameThread(snapshot.value, thread))) {
        threadFingerprints.set(key, fingerprint);
        rememberThread(key, snapshot.value, Date.now());
        syncFailures.delete(`thread:${key}`);
        return snapshot.value;
      }
      const saved = await chatCacheSaveThread(profile.id, chat.cacheToken, thread);
      if (version !== cacheVersion(profile.id)) {
        const latest = await chatCacheThread(profile.id, id);
        if (!latest) throw new Error('Chat conversation is missing');
        return latest;
      }
      threadFingerprints.set(key, fingerprint);
      rememberThread(key, saved, Date.now());
      invalidateChatSnapshots(profile.id);
      syncFailures.delete(`thread:${key}`);
      return saved;
    } catch (error) {
      syncFailures.set(`thread:${key}`, { until: Date.now() + SYNC_RETRY_MS, error });
      throw error;
    }
  })();
  threadSyncs.set(key, operation);
  try { return await operation; }
  finally { if (threadSyncs.get(key) === operation) threadSyncs.delete(key); }
}

export async function cachedThread(profile: DbProfileRow, id: string, force = false): Promise<ChatThread> {
  const key = `${profile.id}:${id}`;
  const snapshot = threadSnapshots.get(key);
  const cached = snapshot?.value ?? await chatCacheThread(profile.id, id);
  if (cached && !snapshot) rememberThread(key, cached, cached.syncedAt);
  if (!force && cached?.syncedAt && Date.now() - (snapshot?.checkedAt ?? cached.syncedAt) < THREAD_STALE_MS) return cached;
  const failure = syncFailures.get(`thread:${profile.id}:${id}`);
  if (!force && failure && Date.now() < failure.until) {
    if (cached?.syncedAt) return cached;
    throw failure.error;
  }
  const version = cacheVersion(profile.id);
  try { return await syncThread(profile, id); }
  catch (error) {
    if (version !== cacheVersion(profile.id)) {
      const latest = await chatCacheThread(profile.id, id);
      if (latest) return latest;
    }
    if (cached?.syncedAt && version === cacheVersion(profile.id)) return cached;
    throw error;
  }
}
