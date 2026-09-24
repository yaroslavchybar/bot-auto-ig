import { chatCacheInbox, chatCacheSaveInbox, chatCacheSaveThread, chatCacheThread } from '../shared/convexClient.js';
import type { DbProfileRow, CachedChatInbox } from '../shared/convexClient.js';
import { InstagramChat } from './instagram.js';
import type { ChatThread } from './instagram.js';
const INBOX_STALE_MS = 60_000;
const THREAD_STALE_MS = 20_000;
const SYNC_RETRY_MS = 120_000;
type InboxMode = 'full' | 'unread';
const inboxSyncs = new Map<string, { mode: InboxMode; promise: Promise<CachedChatInbox> }>();
export const threadSyncs = new Map<string, Promise<ChatThread>>();
const threadChecks = new Map<string, { checkedAt: number; syncedAt: number }>();
const syncFailures = new Map<string, { until: number; error: unknown }>();

export function clearSyncFailures(profileId: string): void {
  for (const key of syncFailures.keys()) {
    if (key === `inbox:${profileId}` || key.startsWith(`thread:${profileId}:`)) syncFailures.delete(key);
  }
  for (const key of threadChecks.keys()) if (key.startsWith(`${profileId}:`)) threadChecks.delete(key);
}

async function syncInbox(profile: DbProfileRow, mode: InboxMode): Promise<CachedChatInbox> {
  const pending = inboxSyncs.get(profile.id);
  if (pending) {
    if (mode === 'unread' || pending.mode === 'full') return pending.promise;
    await pending.promise.catch(() => {});
    return syncInbox(profile, 'full');
  }
  const operation = (async () => {
    try {
      const chat = await InstagramChat.load(profile);
      const inbox = await chat.inbox(mode === 'unread');
      const saved = await chatCacheSaveInbox(profile.id, chat.cacheToken, inbox, mode);
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

export async function cachedInbox(profile: DbProfileRow, force = false): Promise<CachedChatInbox> {
  const cached = await chatCacheInbox(profile.id);
  if (!cached.connected) return cached;
  if (!force && cached.syncedAt && Date.now() - cached.syncedAt < INBOX_STALE_MS) return cached;
  const failure = syncFailures.get(`inbox:${profile.id}`);
  if (!force && failure && Date.now() < failure.until) {
    if (cached.syncedAt) return cached;
    throw failure.error;
  }
  try { return await syncInbox(profile, cached.syncedAt ? 'unread' : 'full'); }
  catch (error) { if (cached.syncedAt) return cached; throw error; }
}

export async function syncThread(profile: DbProfileRow, id: string): Promise<ChatThread> {
  const key = `${profile.id}:${id}`;
  const pending = threadSyncs.get(key);
  if (pending) return pending;
  const operation = (async () => {
    try {
      const chat = await InstagramChat.load(profile);
      const thread = await chat.conversation(id);
      const saved = await chatCacheSaveThread(profile.id, chat.cacheToken, thread);
      threadChecks.set(key, { checkedAt: Date.now(), syncedAt: saved.syncedAt });
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
  const cached = await chatCacheThread(profile.id, id);
  const checked = threadChecks.get(`${profile.id}:${id}`);
  const recentCheck = cached && checked?.syncedAt === cached.syncedAt ? checked.checkedAt : 0;
  if (!force && cached?.syncedAt && Date.now() - Math.max(cached.syncedAt, recentCheck) < THREAD_STALE_MS) return cached;
  const failure = syncFailures.get(`thread:${profile.id}:${id}`);
  if (!force && failure && Date.now() < failure.until) {
    if (cached?.syncedAt) return cached;
    throw failure.error;
  }
  try { return await syncThread(profile, id); }
  catch (error) { if (cached?.syncedAt) return cached; throw error; }
}
