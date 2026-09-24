import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { IgApiClient } from 'instagram-private-api';
import type { ProfileRecord } from '../shared/contracts.js';
import { chatSessionDelete, chatSessionGet, chatSessionHas, chatSessionSave } from '../shared/convexClient.js';
import { resolveProjectRoot } from '../shared/utils.js';
import logger from '../shared/logger.js';
import { completeCaaTwoFactor, loginWithCaa, mobileRequest, useCurrentAppProfile, useCurrentAppVersion } from './caa.js';
import { chatDeviceForProfile } from './devices.js';
import { chatProxy } from './proxy.js';

type Json = Record<string, unknown>;
const record = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const string = (value: unknown): string => value == null ? '' : String(value);
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const sessions = new Map<string, Promise<InstagramChat>>();
const generations = new Map<string, number>();
const writes = new Map<string, Promise<void>>();
const savedStates = new Map<string, { token: string; hash: string }>();
const loggingOut = new Set<string>();
const migrations = new Map<string, Promise<boolean>>();
const oldSessionDir = path.join(resolveProjectRoot(import.meta.url), 'data', 'chat-sessions');

function generation(profileId: string): number { return generations.get(profileId) ?? 0; }

function oldSessionPath(profileId: string): string {
  return path.join(oldSessionDir, `${createHash('sha256').update(profileId).digest('hex')}.json`);
}

// Import sessions created by the local-file Chat test, then remove the old copy.
async function ensureSessionStored(profileId: string): Promise<boolean> {
  const existing = migrations.get(profileId);
  if (existing) return existing;
  const operation = (async () => {
    const remote = await chatSessionHas(profileId);
    if (remote.connected) {
      await fs.rm(oldSessionPath(profileId), { force: true });
      return true;
    }
    let state: string;
    try { state = await fs.readFile(oldSessionPath(profileId), 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    await chatSessionSave(profileId, state, randomUUID());
    await fs.rm(oldSessionPath(profileId), { force: true });
    return true;
  })();
  migrations.set(profileId, operation);
  try { return await operation; }
  finally { if (migrations.get(profileId) === operation) migrations.delete(profileId); }
}

export type ChatMessage = {
  id: string;
  senderId: string;
  text: string;
  timestamp: number;
  kind: string;
  clientContext?: string;
};

export type ChatThread = {
  id: string;
  unread?: boolean;
  title: string;
  users: { id: string; username: string }[];
  messages: ChatMessage[];
  lastSeenAt: { userId: string; timestamp: number }[];
};

function message(raw: unknown): ChatMessage {
  const item = record(raw);
  return {
    id: string(item.item_id ?? item.id),
    senderId: string(item.user_id ?? item.sender_id),
    text: string(item.text),
    timestamp: Number(item.timestamp ?? 0) / 1000,
    kind: string(item.item_type ?? 'text'),
    clientContext: string(item.client_context),
  };
}

export function parseChatThread(raw: unknown): ChatThread {
  const value = record(raw);
  const lastSeenAt = Object.entries(record(value.last_seen_at)).map(([userId, info]) => ({
    userId, timestamp: Number(record(info).timestamp ?? 0) / 1000,
  })).filter(seen => Number.isFinite(seen.timestamp) && seen.timestamp > 0);
  const users = list(value.users).map(rawUser => {
    const user = record(rawUser);
    return { id: string(user.pk ?? user.id), username: string(user.username) };
  });
  return {
    id: string(value.thread_id ?? value.thread_v2_id),
    title: string(value.thread_title) || users.map(user => user.username).filter(Boolean).join(', ') || 'Conversation',
    users,
    messages: list(value.items).map(message),
    lastSeenAt,
  };
}

export function parseChatInboxThread(raw: unknown): ChatThread {
  const thread = parseChatThread(raw);
  // Instagram can return more items than thread_message_limit requests.
  return { ...thread, messages: thread.messages.sort((a, b) => b.timestamp - a.timestamp).slice(0, 1) };
}

export async function fetchChatInboxPages(
  request: (query: Record<string, string>) => Promise<Json>, onlyUnread = false,
): Promise<ChatThread[]> {
  const threads = new Map<string, ChatThread>();
  const limit = onlyUnread ? Infinity : 30;
  const cursors = new Set<string>();
  let cursor = '';
  while (true) {
    const data = await request({
      eb_device_id: '0', igd_request_log_tracking_id: randomUUID(),
      visual_message_return_type: 'unseen', thread_message_limit: '1',
      persistentBadging: 'true', limit: '20', is_prefetching: 'false',
      fetch_reason: cursor ? 'page_scroll' : 'initial_snapshot', include_old_mrs: 'false',
      no_pending_badge: 'true', push_disabled: 'true',
      ...(onlyUnread ? { selected_filter: 'unread' } : {}),
      ...(cursor ? { cursor, direction: 'older' } : {}),
    });
    const inbox = record(data.inbox);
    if (!Array.isArray(inbox.threads)) throw new Error('Instagram returned no DM inbox');
    for (const raw of inbox.threads) {
      const thread = parseChatInboxThread(raw);
      if (thread.id && !threads.has(thread.id)) threads.set(thread.id, thread);
      if (threads.size >= limit) return [...threads.values()];
    }
    const nextCursor = string(inbox.oldest_cursor);
    if (!nextCursor) {
      if (inbox.has_older === true) throw new Error('Instagram DM inbox cursor is missing');
      return [...threads.values()];
    }
    if (cursors.has(nextCursor)) throw new Error('Instagram DM inbox cursor repeated');
    cursors.add(nextCursor);
    cursor = nextCursor;
  }
}

async function saveSession(profileId: string, ig: IgApiClient, token: string,
  expectedGeneration: number, initial = false): Promise<void> {
  if (generation(profileId) !== expectedGeneration) return;
  const previous = writes.get(profileId);
  const operation = (async () => {
    if (previous) await previous.catch(() => {});
    if (generation(profileId) !== expectedGeneration) return;
    const state = JSON.stringify(await ig.state.serialize());
    if (generation(profileId) !== expectedGeneration) return;
    const hash = createHash('sha256').update(state).digest('hex');
    const saved = savedStates.get(profileId);
    if (!initial && saved?.token === token && saved.hash === hash) return;
    await chatSessionSave(profileId, state, token, initial ? undefined : token);
    savedStates.set(profileId, { token, hash });
  })();
  writes.set(profileId, operation);
  try { await operation; }
  finally { if (writes.get(profileId) === operation) writes.delete(profileId); }
}

// Separate mobile session; browser cookies cannot establish it.
export class InstagramChat {
  private constructor(private profile: ProfileRecord, private readonly ig: IgApiClient,
    private readonly sessionGeneration: number, private readonly sessionToken: string) {}

  get cacheToken(): string { return this.sessionToken; }

  static async hasSession(profileId: string): Promise<boolean> {
    if (loggingOut.has(profileId)) return false;
    const connected = await ensureSessionStored(profileId);
    return connected && !loggingOut.has(profileId);
  }

  static async load(profile: ProfileRecord): Promise<InstagramChat> {
    if (loggingOut.has(profile.id)) throw new Error('Chat session is logging out');
    let pending = sessions.get(profile.id);
    if (!pending) {
      const currentGeneration = generation(profile.id);
      pending = (async () => {
        await ensureSessionStored(profile.id);
        const saved = await chatSessionGet(profile.id);
        if (!saved.connected) throw new Error('Connect this profile to Instagram Chat first');
        const ig = new IgApiClient();
        await ig.state.deserialize(saved.state);
        if (generation(profile.id) !== currentGeneration) throw new Error('Chat session was logged out');
        savedStates.set(profile.id, { token: saved.token,
          hash: createHash('sha256').update(saved.state).digest('hex') });
        useCurrentAppVersion(ig);
        ig.state.proxyUrl = chatProxy(profile) || '';
        return new InstagramChat(profile, ig, currentGeneration, saved.token);
      })();
      sessions.set(profile.id, pending);
      pending.catch(() => { if (sessions.get(profile.id) === pending) sessions.delete(profile.id); });
    }
    const chat = await pending;
    chat.profile = profile;
    chat.ig.state.proxyUrl = chatProxy(profile) || '';
    return chat;
  }

  static async login(profile: ProfileRecord, username: string, password: string, authenticatorKey: string): Promise<void> {
    if (loggingOut.has(profile.id)) throw new Error('Chat session is logging out');
    const currentGeneration = generation(profile.id);
    const token = randomUUID();
    const ig = new IgApiClient();
    ig.state.generateDevice(`${username}:${profile.id}`);
    ig.state.proxyUrl = chatProxy(profile) || '';
    useCurrentAppProfile(ig, chatDeviceForProfile(profile.id));
    const context = await loginWithCaa(ig, username, password);
    if (context) await completeCaaTwoFactor(ig, context, authenticatorKey);
    await saveSession(profile.id, ig, token, currentGeneration, true);
    if (generation(profile.id) !== currentGeneration) throw new Error('Chat session was logged out');
    sessions.set(profile.id, Promise.resolve(new InstagramChat(profile, ig, currentGeneration, token)));
  }

  static async logout(profileId: string): Promise<void> {
    loggingOut.add(profileId);
    generations.set(profileId, generation(profileId) + 1);
    sessions.delete(profileId);
    try {
      await migrations.get(profileId)?.catch(() => {});
      await writes.get(profileId)?.catch(() => {});
      savedStates.delete(profileId);
      await chatSessionDelete(profileId);
      await fs.rm(oldSessionPath(profileId), { force: true });
    } finally { loggingOut.delete(profileId); }
  }

  async inbox(onlyUnread = false): Promise<{ viewerId: string; threads: ChatThread[] }> {
    const threads = await fetchChatInboxPages(query =>
      mobileRequest(this.ig, 'GET', 'direct_v2/inbox/', undefined, query), onlyUnread);
    await saveSession(this.profile.id, this.ig, this.sessionToken, this.sessionGeneration);
    return { viewerId: this.ig.state.extractUserId(), threads };
  }

  async conversation(threadId: string): Promise<ChatThread> {
    const data = await mobileRequest(this.ig, 'GET', `direct_v2/threads/${threadId}/`, undefined, {
      visual_message_return_type: 'unseen', direction: 'older', seq_id: '40065', limit: '8',
    });
    await saveSession(this.profile.id, this.ig, this.sessionToken, this.sessionGeneration);
    if (!data.thread) throw new Error('Instagram returned no DM thread');
    return parseChatThread(data.thread);
  }

  async reply(threadId: string, text: string, clientContext = randomUUID()): Promise<ChatMessage> {
    const token = clientContext;
    const links = text.match(/https?:\/\/[^\s]+/g);
    const fields: Record<string, string> = {
      action: 'send_item', is_x_transport_forward: 'false', send_silently: 'false',
      is_shh_mode: '0', send_attribution: 'message_button', client_context: token,
      device_id: this.ig.state.deviceId, mutation_token: token, _uuid: this.ig.state.uuid,
      btt_dual_send: 'false',
      nav_chain: '1qT:feed_timeline:1,1qT:feed_timeline:2,1qT:feed_timeline:3,7Az:direct_inbox:4,7Az:direct_inbox:5,5rG:direct_thread:7',
      is_ae_dual_send: 'false', offline_threading_id: token,
      thread_ids: `[${threadId}]`,
      ...(links ? { link_text: text, link_urls: JSON.stringify(links) } : { text }),
    };
    const result = await mobileRequest(this.ig, 'POST',
      `direct_v2/threads/broadcast/${links ? 'link' : 'text'}/`, fields);
    const sent = message(result.payload);
    if (!sent.id) throw new Error('Instagram did not confirm the DM reply');
    void saveSession(this.profile.id, this.ig, this.sessionToken, this.sessionGeneration)
      .catch(err => logger.warn({ err, profileId: this.profile.id }, 'Could not persist Chat session after sent DM'));
    return { ...sent, text, timestamp: sent.timestamp || Date.now(), clientContext: token };
  }
}
