import { randomUUID } from 'node:crypto'
import { IgApiClient, type UserFeed } from 'instagram-private-api';
import type { ProfileRecord } from '../shared/contracts.js';
import { chatSessionDelete, chatSessionGet, chatSessionHas, chatSessionSave } from '../shared/convexClient.js';
import logger from '../shared/logger.js';
import { completeCaaTwoFactor, loginWithCaa, mobileRequest, useCurrentAppProfile, useCurrentAppVersion } from './caa.js';
import { chatDeviceForProfile } from './devices.js';
import { chatProxy, configureMobileProxyTransport } from './proxy.js';
import { uploadChatAttachment, type AttachmentKind, type VideoMetadata } from './attachments.js';
import { getChatCache } from './cache.js'
import { sessionStateHash } from './sessionState.js'
import { LruMap } from '../shared/lru.js'
import type { AttachmentBody } from './attachments.js'

type Json = Record<string, unknown>;
const record = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const string = (value: unknown): string => value == null ? '' : String(value);
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const sessions = new LruMap<string, Promise<InstagramChat>>(32);
const generations = new Map<string, number>();
const writes = new Map<string, Promise<void>>();
const savedStates = new LruMap<string, { token: string; hash: string }>(64);
const loggingOut = new Set<string>();
function generation(profileId: string): number { return generations.get(profileId) ?? 0; }

export type ChatMessage = {
  id: string;
  senderId: string;
  text: string;
  timestamp: number;
  kind: string;
  clientContext?: string;
  mediaType?: AttachmentKind;
  mediaUrl?: string;
  reactions?: { senderId: string; emoji: string }[];
};

export type ChatThread = {
  id: string;
  unread?: boolean;
  confirmedMessageIds?: string[];
  title: string;
  users: { id: string; username: string }[];
  messages: ChatMessage[];
  lastSeenAt: { userId: string; timestamp: number }[];
};

export type ChatMessagePage = { thread: ChatThread; nextCursor: string; hasOlder: boolean };

export function parseChatMessagePage(raw: unknown): ChatMessagePage {
  const page = record(raw);
  const thread = record(page.thread);
  if (!page.thread) throw new Error('Instagram returned no DM thread');
  const hasOlder = thread.has_older === true;
  const nextCursor = hasOlder ? string(thread.oldest_cursor) : '';
  if (hasOlder && !nextCursor) throw new Error('Instagram DM thread cursor is missing');
  return { thread: parseChatThread(thread), nextCursor, hasOlder };
}

function message(raw: unknown): ChatMessage {
  const item = record(raw);
  const kind = string(item.item_type ?? 'text');
  const media = record(kind.includes('voice')
    ? record(item.voice_media).media ?? item.media
    : kind === 'raven_media'
      ? record(item.visual_media).media ?? item.media
      : item.media ?? record(item.visual_media).media);
  const audioUrl = string(record(media.audio).audio_src);
  const videoUrl = string(record(list(media.video_versions)[0]).url);
  const imageUrl = string(record(list(record(media.image_versions2).candidates)[0]).url);
  const mediaType: AttachmentKind | undefined = kind.includes('voice') ? 'voice' :
    kind.includes('video') || Number(media.media_type) === 2 ? 'video' :
      kind.includes('photo') || imageUrl ? 'photo' : undefined;
  const mediaUrl = mediaType === 'voice' ? audioUrl : mediaType === 'video' ? videoUrl : imageUrl;
  const reactions = list(record(item.reactions).emojis).map(rawReaction => {
    const reaction = record(rawReaction);
    return { senderId: string(reaction.sender_id), emoji: string(reaction.emoji) };
  }).filter(reaction => reaction.senderId && reaction.emoji);
  return {
    id: string(item.item_id ?? item.id),
    senderId: string(item.user_id ?? item.sender_id),
    text: string(item.text),
    timestamp: Number(item.timestamp ?? 0) / 1000,
    kind,
    ...(item.client_context ? { clientContext: string(item.client_context) } : {}),
    ...(mediaType ? { mediaType } : {}),
    ...(mediaUrl.startsWith('https://') ? { mediaUrl } : {}),
    ...(reactions.length ? { reactions } : {}),
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
  request: (query: Record<string, string>) => Promise<Json>,
  onlyUnread = false,
): Promise<ChatThread[]> {
  const threads = new Map<string, ChatThread>()
  const limit = onlyUnread ? 200 : 30
  const cursors = new Set<string>()
  let cursor = ''
  while (true) {
    const data = await request({
      eb_device_id: '0',
      igd_request_log_tracking_id: randomUUID(),
      visual_message_return_type: 'unseen',
      thread_message_limit: '1',
      persistentBadging: 'true',
      limit: '20',
      is_prefetching: 'false',
      fetch_reason: cursor ? 'page_scroll' : 'initial_snapshot',
      include_old_mrs: 'false',
      no_pending_badge: 'true',
      push_disabled: 'true',
      ...(onlyUnread ? { selected_filter: 'unread' } : {}),
      ...(cursor ? { cursor, direction: 'older' } : {}),
    })
    const inbox = record(data.inbox)
    if (!Array.isArray(inbox.threads)) throw new Error('Instagram returned no DM inbox')
    for (const raw of inbox.threads) {
      const thread = parseChatInboxThread(raw)
      if (thread.id && !threads.has(thread.id)) threads.set(thread.id, thread)
      if (threads.size >= limit) return [...threads.values()]
    }
    const nextCursor = string(inbox.oldest_cursor)
    if (!nextCursor) {
      if (inbox.has_older === true) throw new Error('Instagram DM inbox cursor is missing')
      return [...threads.values()]
    }
    if (cursors.has(nextCursor)) throw new Error('Instagram DM inbox cursor repeated')
    cursors.add(nextCursor)
    cursor = nextCursor
  }
}

async function saveSession(
  profileId: string,
  ig: IgApiClient,
  token: string,
  expectedGeneration: number,
  initial = false,
): Promise<void> {
  if (generation(profileId) !== expectedGeneration) return
  const previous = writes.get(profileId)
  const operation = (async () => {
    if (previous) await previous.catch(() => {})
    if (generation(profileId) !== expectedGeneration) return
    const state = JSON.stringify(await ig.state.serialize())
    if (generation(profileId) !== expectedGeneration) return
    const hash = sessionStateHash(state)
    const saved = savedStates.get(profileId)
    if (!initial && saved?.token === token && saved.hash === hash) return
    await chatSessionSave(profileId, state, token, initial ? undefined : token)
    savedStates.set(profileId, { token, hash })
  })()
  writes.set(profileId, operation)
  try {
    await operation
  } finally {
    if (writes.get(profileId) === operation) writes.delete(profileId)
  }
}

/** Pinned posts are out of date order; only ordinary posts can end the date window. */
export async function fetchRecentProfilePosts(
  feed: Pick<UserFeed, 'items' | 'isMoreAvailable' | 'toPlain'>, sinceDate: number, postLimit: number,
  onPage?: () => Promise<void>,
): Promise<{ id: string; code: string }[]> {
  const posts: { id: string; code: string }[] = [];
  const seen = new Set<string>();
  const cursors = new Set<string>();
  let exhausted = false;
  while (posts.length < postLimit && !exhausted) {
    await onPage?.();
    const items = await feed.items();
    if (!Array.isArray(items)) throw new Error('Instagram returned no profile posts');
    if (!items.length) {
      if (feed.isMoreAvailable()) throw new Error('Instagram returned an incomplete profile feed');
      break;
    }
    for (const item of items) {
      const timestamp = Number(item.taken_at) * 1000;
      if (!Number.isFinite(timestamp) || timestamp <= 0) throw new Error('Instagram returned a post without a date');
      if (timestamp < sinceDate) {
        if (!list(record(item).timeline_pinned_user_ids).length) exhausted = true;
        continue;
      }
      const id = String(item.pk ?? '').split('_')[0]!;
      const code = String(item.code ?? '');
      if (!/^\d+$/.test(id) || !/^[\w-]+$/.test(code)) throw new Error('Instagram returned a post without an ID or shortcode');
      if (seen.has(id)) continue;
      seen.add(id);
      posts.push({ id, code });
      if (posts.length >= postLimit) break;
    }
    if (posts.length >= postLimit || exhausted || !feed.isMoreAvailable()) break;
    const cursor = string(feed.toPlain().nextMaxId);
    if (!cursor || cursors.has(cursor)) throw new Error('Instagram profile feed cursor is missing or repeated');
    cursors.add(cursor);
  }
  return posts;
}

// Separate mobile session; browser cookies cannot establish it.
export class InstagramChat {
  private constructor(private profile: ProfileRecord, private readonly ig: IgApiClient,
    private readonly sessionGeneration: number, private readonly sessionToken: string) {}

  get cacheToken(): string { return this.sessionToken; }

  static forgetSession(profileId: string): void {
    generations.set(profileId, generation(profileId) + 1)
    sessions.delete(profileId)
    savedStates.delete(profileId)
    getChatCache().clear(profileId)
  }

  static async hasSession(profileId: string): Promise<boolean> {
    if (loggingOut.has(profileId)) return false
    if (sessions.has(profileId)) return true
    const connected = (await chatSessionHas(profileId)).connected
    return connected && !loggingOut.has(profileId)
  }

  static async load(profile: ProfileRecord): Promise<InstagramChat> {
    if (loggingOut.has(profile.id)) throw new Error('Chat session is logging out')
    let pending = sessions.get(profile.id)
    const reused = Boolean(pending)
    if (!pending) {
      const currentGeneration = generation(profile.id)
      pending = (async () => {
        const saved = await chatSessionGet(profile.id)
        if (!saved.connected) throw new Error('Connect this profile to Instagram Chat first')
        const ig = new IgApiClient()
        configureMobileProxyTransport(ig)
        await ig.state.deserialize(saved.state)
        if (generation(profile.id) !== currentGeneration)
          throw new Error('Chat session was logged out')
        savedStates.set(profile.id, { token: saved.token, hash: sessionStateHash(saved.state) })
        useCurrentAppVersion(ig)
        ig.state.proxyUrl = chatProxy(profile) || ''
        return new InstagramChat(profile, ig, currentGeneration, saved.token)
      })()
      sessions.set(profile.id, pending)
      pending.catch(() => {
        if (sessions.get(profile.id) === pending) sessions.delete(profile.id)
      })
    }
    const chat = await pending
    if (reused && getChatCache().token(profile.id) !== chat.cacheToken) {
      generations.set(profile.id, generation(profile.id) + 1)
      sessions.delete(profile.id)
      savedStates.delete(profile.id)
      return InstagramChat.load(profile)
    }
    getChatCache().connect(profile.id, chat.cacheToken, chat.ig.state.extractUserId())
    chat.profile = profile
    chat.ig.state.proxyUrl = chatProxy(profile) || ''
    return chat
  }

  static async login(
    profile: ProfileRecord,
    username: string,
    password: string,
    authenticatorKey: string,
  ): Promise<void> {
    if (loggingOut.has(profile.id)) throw new Error('Chat session is logging out')
    const currentGeneration = generation(profile.id)
    const token = randomUUID()
    const ig = new IgApiClient()
    configureMobileProxyTransport(ig)
    ig.state.generateDevice(`${username}:${profile.id}`)
    ig.state.proxyUrl = chatProxy(profile) || ''
    useCurrentAppProfile(ig, chatDeviceForProfile(profile.id))
    const context = await loginWithCaa(ig, username, password)
    if (context) await completeCaaTwoFactor(ig, context, authenticatorKey)
    await saveSession(profile.id, ig, token, currentGeneration, true)
    if (generation(profile.id) !== currentGeneration) throw new Error('Chat session was logged out')
    sessions.set(
      profile.id,
      Promise.resolve(new InstagramChat(profile, ig, currentGeneration, token)),
    )
    getChatCache().connect(profile.id, token, ig.state.extractUserId())
  }

  static async logout(profileId: string): Promise<void> {
    loggingOut.add(profileId)
    generations.set(profileId, generation(profileId) + 1)
    sessions.delete(profileId)
    try {
      await writes.get(profileId)?.catch(() => {})
      savedStates.delete(profileId)
      await chatSessionDelete(profileId)
      getChatCache().clear(profileId)
    } finally {
      loggingOut.delete(profileId)
    }
  }

  /** Profile setup preserves the other identity field on each separate update. */
  private async editProfile(identity: { username?: string; fullName?: string }): Promise<void> {
    const current = await this.ig.account.currentUser();
    if (!current.username || typeof current.full_name !== 'string')
      throw new Error('Instagram did not return the current profile identity');
    const username = identity.username ?? current.username;
    const fullName = identity.fullName ?? current.full_name;
    const updated = await this.ig.account.editProfile({
      username, first_name: fullName,
      external_url: current.external_url ?? '', gender: String(current.gender ?? ''),
      phone_number: current.phone_number ?? '', biography: current.biography ?? '',
      email: current.email ?? '',
    });
    if (updated.username !== username || updated.full_name !== fullName)
      throw new Error('Instagram did not confirm the profile change');
    await saveSession(this.profile.id, this.ig, this.sessionToken, this.sessionGeneration);
  }

  async updateUsername(username: string): Promise<void> {
    await this.editProfile({ username });
  }

  async updateFullName(fullName: string): Promise<void> {
    await this.editProfile({ fullName });
  }

  async changeProfilePicture(image: Buffer): Promise<void> {
    const result = await this.ig.account.changeProfilePicture(image);
    if (result.status !== 'ok') throw new Error('Instagram did not confirm the profile picture change');
    await saveSession(this.profile.id, this.ig, this.sessionToken, this.sessionGeneration);
  }

  async inbox(onlyUnread = false): Promise<{ viewerId: string; threads: ChatThread[] }> {
    const threads = await fetchChatInboxPages(query =>
      mobileRequest(this.ig, 'GET', 'direct_v2/inbox/', undefined, query), onlyUnread);
    await saveSession(this.profile.id, this.ig, this.sessionToken, this.sessionGeneration);
    return { viewerId: this.ig.state.extractUserId(), threads };
  }

  /** Recent post IDs and shortcodes from the profile grid; same shape the scraper checkpoints. */
  async recentProfilePosts(username: string, sinceDate: number, postLimit: number, onPage?: () => Promise<void>):
    Promise<{ id: string; code: string }[]> {
    const user = await this.ig.user.searchExact(username);
    if (!user.pk) throw new Error(`Instagram could not find @${username}`);
    const posts = await fetchRecentProfilePosts(this.ig.feed.user(user.pk), sinceDate, postLimit, onPage);
    await saveSession(this.profile.id, this.ig, this.sessionToken, this.sessionGeneration);
    return posts;
  }

  async conversation(threadId: string): Promise<ChatThread> {
    return (await this.conversationPage(threadId)).thread;
  }

  async conversationPage(threadId: string, cursor = ''): Promise<ChatMessagePage> {
    const data = await mobileRequest(this.ig, 'GET', `direct_v2/threads/${threadId}/`, undefined, {
      visual_message_return_type: 'unseen', direction: 'older', seq_id: '40065', limit: '10',
      ...(cursor ? { cursor } : {}),
    });
    await saveSession(this.profile.id, this.ig, this.sessionToken, this.sessionGeneration);
    return parseChatMessagePage(data);
  }

  async reply(threadId: string, text: string, clientContext: string = randomUUID()): Promise<ChatMessage> {
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
      .catch(err => logger.error({ event: 'chat.instagram.persist_chat_session_after_sent', error: err, profileId: this.profile.id, message: 'Could not persist Chat session after sent DM', outcome: 'error' }));
    return { ...sent, text, timestamp: sent.timestamp || Date.now(), clientContext: token };
  }

  async sendAttachment(threadId: string, kind: AttachmentKind, bytes: AttachmentBody,
    clientContext: string = randomUUID(), video?: VideoMetadata): Promise<ChatMessage> {
    const uploaded = await uploadChatAttachment(this.ig, kind, bytes, video);
    const token = clientContext;
    const base = { thread_ids: `[${threadId}]`, client_context: token,
      attachment_fbid: uploaded.mediaId, device_id: this.ig.state.deviceId,
      mutation_token: token, _uuid: this.ig.state.uuid, offline_threading_id: token };
    let endpoint: string;
    let fields: Record<string, string>;
    if (kind === 'photo') {
      endpoint = 'direct_v2/threads/broadcast/photo_attachment/';
      fields = { action: 'send_item', is_x_transport_forward: 'false', is_shh_mode: '0',
        send_attribution: 'inbox', allow_full_aspect_ratio: 'true', btt_dual_send: 'false',
        is_ae_dual_send: 'false', ...base };
    } else if (kind === 'voice') {
      endpoint = 'direct_v2/threads/broadcast/voice_attachment/';
      fields = { action: 'send_item', send_attribution: 'inbox', ...base,
        waveform: JSON.stringify(Array.from({ length: 70 }, () =>
          Math.round((0.2 + Math.random() * 0.75) * 1000) / 1000)),
        waveform_sampling_frequency_hz: '10', upload_id: uploaded.uploadId ?? '' };
    } else {
      endpoint = 'direct_v2/threads/broadcast/raven_attachment/?video=1';
      const metadata = uploaded.video!;
      const seconds = String(Math.floor(Date.now() / 1000));
      const device = this.ig.state.deviceString.split(';').map(part => part.trim());
      const [androidVersion, androidRelease] = (device[0] ?? '30/11').split('/');
      const payload = { recipient_users: '[]', view_mode: 'permanent', has_camera_metadata: '1',
        camera_entry_point: '3', thread_ids: `[${threadId}]`, reshare_mode: 'allow_reshare',
        original_media_type: '2', send_attribution: 'direct_composer', client_context: token,
        camera_session_id: randomUUID(), attachment_fbid: uploaded.mediaId,
        include_e2ee_mentioned_user_list: '1', hide_from_profile_grid: 'false',
        timezone_offset: '0', client_shared_at: seconds, configure_mode: '2', source_type: '3',
        camera_position: 'back', video_result: uploaded.mediaId,
        _uid: this.ig.state.extractUserId(), device_id: this.ig.state.deviceId,
        composition_id: randomUUID(), mutation_token: token, _uuid: this.ig.state.uuid,
        creation_surface: 'camera', has_ig_camera_edits: 'false', capture_type: 'normal',
        audience: 'default', upload_id: uploaded.uploadId, client_timestamp: seconds,
        media_transformation_info: JSON.stringify({ width: String(metadata.width),
          height: String(metadata.height), x_transform: '0', y_transform: '0', zoom: '1.0',
          rotation: '0.0', background_coverage: '0.0' }),
        clips: [{ length: metadata.duration, source_type: '3', camera_position: 'back' }],
        poster_frame_index: 0, length: metadata.duration, audio_muted: false,
        edits: { filter_type: 0, filter_strength: 1.0 },
        extra: { source_width: metadata.width, source_height: metadata.height },
        device: { manufacturer: (device[3] ?? 'Google/google').split('/')[0],
          model: device[4] ?? 'Pixel', android_version: Number(androidVersion),
          android_release: androidRelease ?? '11' } };
      fields = { ...this.ig.request.sign(payload) };
    }
    const result = await mobileRequest(this.ig, 'POST', endpoint, fields);
    const sent = message(result.payload);
    if (!sent.id) throw new Error('Instagram did not confirm the DM attachment');
    void saveSession(this.profile.id, this.ig, this.sessionToken, this.sessionGeneration)
      .catch(err => logger.error({ event: 'chat.instagram.persist_chat_session_after_sent', error: err, profileId: this.profile.id, message: 'Could not persist Chat session after sent attachment', outcome: 'error' }));
    return { ...sent, kind: sent.kind === 'text' ? kind : sent.kind,
      mediaType: kind, timestamp: sent.timestamp || Date.now(), clientContext: token };
  }

  async react(threadId: string, item: Pick<ChatMessage, 'id' | 'kind' | 'clientContext'>,
    emoji: string, remove = false): Promise<void> {
    const token = randomUUID();
    const result = await mobileRequest(this.ig, 'POST', 'direct_v2/threads/broadcast/reaction/', {
      action: 'send_item', is_x_transport_forward: 'false', send_silently: 'false',
      is_shh_mode: '0', send_attribution: 'message_reaction', client_context: token,
      device_id: this.ig.state.deviceId, mutation_token: token, btt_dual_send: 'false',
      nav_chain: '1qT:feed_timeline:1,1qT:feed_timeline:2,1qT:feed_timeline:3,7Az:direct_inbox:4,7Az:direct_inbox:5,5rG:direct_thread:7',
      is_ae_dual_send: 'false', offline_threading_id: token, thread_ids: `[${threadId}]`,
      item_type: 'reaction', reaction_type: 'like', reaction_status: remove ? 'deleted' : 'created',
      node_type: 'item', item_id: item.id, emoji, reaction_action_source: 'reaction_sheet',
      ...(item.clientContext ? { original_message_client_context: item.clientContext } : {}),
      ...(item.kind ? { target_item_type: item.kind } : {}),
    });
    if (result.status !== 'ok') throw new Error('Instagram did not confirm the reaction');
  }

  async unsend(threadId: string, itemId: string): Promise<void> {
    const result = await mobileRequest(this.ig, 'POST',
      `direct_v2/threads/${threadId}/items/${itemId}/delete/`, { _uuid: this.ig.state.uuid });
    if (result.status !== 'ok') throw new Error('Instagram did not confirm the unsend');
    void saveSession(this.profile.id, this.ig, this.sessionToken, this.sessionGeneration)
      .catch(err => logger.error({ event: 'chat.instagram.persist_chat_session_after_unsend', error: err, profileId: this.profile.id, message: 'Could not persist Chat session after unsend', outcome: 'error' }));
  }
}
