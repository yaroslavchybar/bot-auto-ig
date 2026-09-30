import { randomUUID } from 'node:crypto'
import type { ProfileRecord } from '../shared/contracts.js'
import { runtimeUrl } from '../shared/runtime.js'
import { currentRequestId } from '../shared/logger.js'
import { getChatCache } from './cache.js'
import type { AttachmentKind, AttachmentBody, VideoMetadata } from './attachments.js'
type Json = Record<string, unknown>
const record = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
const string = (value: unknown): string => (value == null ? '' : String(value))
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

export class InstagramError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs: number,
    name = 'InstagramError',
  ) {
    super(message)
    this.name = name
  }
}
async function mobile<T>(
  action: string,
  profileId: string,
  args: unknown = {},
  token?: string,
): Promise<T> {
  const response = await fetch(`${runtimeUrl()}/instagram/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': currentRequestId() || randomUUID(),
    },
    body: JSON.stringify({ profileId, args, token }),
    signal: AbortSignal.timeout(360_000),
  })
  const body = (await response.json().catch((error: unknown) => {
    if (response.ok) throw error
    return {}
  })) as {
    error?: { message: string; name: string; status: number; retryAfterMs: number }
  }
  if (!response.ok) {
    const error = body?.error
    throw new InstagramError(
      error?.message || 'Instagram request failed',
      error?.status || response.status,
      error?.retryAfterMs || 0,
      error?.name,
    )
  }
  return body as T
}

export type ChatMessage = {
  id: string
  senderId: string
  text: string
  timestamp: number
  kind: string
  clientContext?: string
  mediaType?: AttachmentKind
  mediaUrl?: string
  reactions?: { senderId: string; emoji: string }[]
}

export type ChatThread = {
  id: string
  unread?: boolean
  confirmedMessageIds?: string[]
  title: string
  users: { id: string; username: string }[]
  messages: ChatMessage[]
  lastSeenAt: { userId: string; timestamp: number }[]
}

export type ChatMessagePage = { thread: ChatThread; nextCursor: string; hasOlder: boolean }

export function parseChatMessagePage(raw: unknown): ChatMessagePage {
  const page = record(raw)
  const thread = record(page.thread)
  if (!page.thread) throw new Error('Instagram returned no DM thread')
  const hasOlder = thread.has_older === true
  const nextCursor = hasOlder ? string(thread.oldest_cursor) : ''
  if (hasOlder && !nextCursor) throw new Error('Instagram DM thread cursor is missing')
  return { thread: parseChatThread(thread), nextCursor, hasOlder }
}

function message(raw: unknown): ChatMessage {
  const item = record(raw)
  const kind = string(item.item_type ?? 'text')
  const media = record(
    kind.includes('voice')
      ? (record(item.voice_media).media ?? item.media)
      : kind === 'raven_media'
        ? (record(item.visual_media).media ?? item.media)
        : (item.media ?? record(item.visual_media).media),
  )
  const audioUrl = string(record(media.audio).audio_src)
  const videoUrl = string(record(list(media.video_versions)[0]).url)
  const imageUrl = string(record(list(record(media.image_versions2).candidates)[0]).url)
  const mediaType: AttachmentKind | undefined = kind.includes('voice')
    ? 'voice'
    : kind.includes('video') || Number(media.media_type) === 2
      ? 'video'
      : kind.includes('photo') || imageUrl
        ? 'photo'
        : undefined
  const mediaUrl = mediaType === 'voice' ? audioUrl : mediaType === 'video' ? videoUrl : imageUrl
  const reactions = list(record(item.reactions).emojis)
    .map((rawReaction) => {
      const reaction = record(rawReaction)
      return { senderId: string(reaction.sender_id), emoji: string(reaction.emoji) }
    })
    .filter((reaction) => reaction.senderId && reaction.emoji)
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
  }
}

export function parseChatThread(raw: unknown): ChatThread {
  const value = record(raw)
  const lastSeenAt = Object.entries(record(value.last_seen_at))
    .map(([userId, info]) => ({
      userId,
      timestamp: Number(record(info).timestamp ?? 0) / 1000,
    }))
    .filter((seen) => Number.isFinite(seen.timestamp) && seen.timestamp > 0)
  const users = list(value.users).map((rawUser) => {
    const user = record(rawUser)
    return { id: string(user.pk ?? user.id), username: string(user.username) }
  })
  return {
    id: string(value.thread_id ?? value.thread_v2_id),
    title:
      string(value.thread_title) ||
      users
        .map((user) => user.username)
        .filter(Boolean)
        .join(', ') ||
      'Conversation',
    users,
    messages: list(value.items).map(message),
    lastSeenAt,
  }
}

export function parseChatInboxThread(raw: unknown): ChatThread {
  const thread = parseChatThread(raw)
  // Instagram can return more items than thread_message_limit requests.
  return {
    ...thread,
    messages: thread.messages.sort((a, b) => b.timestamp - a.timestamp).slice(0, 1),
  }
}

/** Typed bridge to the custom Rust mobile client. Session state stays in Rust. */
export class InstagramChat {
  private constructor(
    private readonly profileId: string,
    readonly cacheToken: string,
  ) {}
  static forgetSession(profileId: string): void {
    getChatCache().clear(profileId)
  }
  static async hasSession(profileId: string): Promise<boolean> {
    return (await mobile<{ connected: boolean }>('has', profileId)).connected
  }
  static async load(profile: ProfileRecord): Promise<InstagramChat> {
    const session = await mobile<{ token: string; viewerId: string }>('load', profile.id)
    getChatCache().connect(profile.id, session.token, session.viewerId)
    return new InstagramChat(profile.id, session.token)
  }
  static async login(
    profile: ProfileRecord,
    username: string,
    password: string,
    authenticatorKey: string,
  ): Promise<void> {
    const session = await mobile<{ token: string; viewerId: string }>('login', profile.id, {
      username,
      password,
      authenticatorKey,
    })
    getChatCache().connect(profile.id, session.token, session.viewerId)
  }
  static async logout(profileId: string): Promise<void> {
    await mobile('logout', profileId)
    getChatCache().clear(profileId)
  }
  private request<T>(action: string, args: unknown = {}): Promise<T> {
    return mobile(action, this.profileId, args, this.cacheToken)
  }
  async updateUsername(username: string): Promise<void> {
    await this.request('username', { username })
  }
  async updateFullName(fullName: string): Promise<void> {
    await this.request('fullName', { fullName })
  }
  async changeProfilePicture(image: Buffer): Promise<void> {
    await this.request('avatar', { image: image.toString('base64') })
  }
  async inbox(onlyUnread = false): Promise<{ viewerId: string; threads: ChatThread[] }> {
    const result = await this.request<{ viewerId: string; threads: unknown[] }>('inbox', {
      onlyUnread,
    })
    return { viewerId: result.viewerId, threads: result.threads.map(parseChatInboxThread) }
  }
  async conversation(threadId: string): Promise<ChatThread> {
    return (await this.conversationPage(threadId)).thread
  }
  async conversationPage(threadId: string, cursor = ''): Promise<ChatMessagePage> {
    return parseChatMessagePage(await this.request('thread', { threadId, cursor }))
  }
  async reply(
    threadId: string,
    text: string,
    clientContext: string = randomUUID(),
  ): Promise<ChatMessage> {
    const result = await this.request<Json>('reply', { threadId, text, clientContext })
    const sent = message(result.payload)
    return { ...sent, text, timestamp: sent.timestamp || Date.now(), clientContext }
  }
  async sendAttachment(
    threadId: string,
    kind: AttachmentKind,
    bytes: AttachmentBody,
    clientContext: string = randomUUID(),
    video?: VideoMetadata,
  ): Promise<ChatMessage> {
    const result = await this.request<Json>('attachment', {
      threadId,
      kind,
      uploadId: bytes.id,
      clientContext,
      video,
    })
    const sent = message(result.payload)
    return {
      ...sent,
      kind: sent.kind === 'text' ? kind : sent.kind,
      mediaType: kind,
      timestamp: sent.timestamp || Date.now(),
      clientContext,
    }
  }
  async react(
    threadId: string,
    item: Pick<ChatMessage, 'id' | 'kind' | 'clientContext'>,
    emoji: string,
    remove = false,
  ): Promise<void> {
    await this.request('reaction', {
      threadId,
      itemId: item.id,
      kind: item.kind,
      clientContext: item.clientContext,
      emoji,
      remove,
    })
  }
  async unsend(threadId: string, itemId: string): Promise<void> {
    await this.request('unsend', { threadId, itemId })
  }
}
