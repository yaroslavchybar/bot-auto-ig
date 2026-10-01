import { Commands } from '../worker/commands.js'
import { stageAttachment, removeAttachment } from './uploads.js'
import { chatTagsRequest, profilesGetById, profilesList } from '../shared/convexClient.js'
import { broadcast } from '../websocket.js'
import { chatMarkUnsent } from './store.js'
import {
  cachedInbox,
  cachedThread,
  clearSyncFailures,
  invalidateChatSnapshots,
  syncThread,
  threadSyncs,
} from './sync.js'
import { ExternalServiceError, NotFoundError, ValidationError } from '../shared/errors.js'
import logger from '../shared/logger.js'
import { InstagramChat, InstagramError } from './instagram.js'
import type { ChatThread } from './instagram.js'
import type { AttachmentKind, VideoMetadata } from './attachments.js'
import { parseChatCredentials } from './totp.js'

const commands = new Commands()
commands.register(
  'chat.get.tags',
  'GET',
  '/tags',
  async (_req, res) => {
    res.json(await chatTagsRequest())
  },
  'json',
)
commands.register(
  'chat.post.profileId_tags',
  'POST',
  '/:profileId/tags',
  async (req, res) => {
    const profile = await selectedProfile(req.params.profileId)
    const body = req.body as Record<string, unknown>
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      typeof body.tag !== 'string' ||
      typeof body.enabled !== 'boolean'
    )
      throw new ValidationError('Invalid chat tag')
    const rows = await chatTagsRequest({
      profileId: profile.id,
      threadId: threadId(body.threadId),
      tag: body.tag,
      enabled: body.enabled,
    })
    broadcast({ type: 'chat_changed', profileId: profile.id, tagsChanged: true })
    res.json(rows)
  },
  'json',
)
commands.register(
  'chat.get.threads',
  'GET',
  '/threads',
  async (req, res) => {
    const profiles = (await profilesList()).filter(
      (profile) => profile.igLoggedIn && profile.status !== 'deleting',
    )
    const threads: (ChatThread & { profileId: string; profileName: string; viewerId: string })[] =
      []
    const errors: { profileName: string; message: string }[] = []
    for (let index = 0; index < profiles.length; index += 4) {
      await Promise.all(
        profiles.slice(index, index + 4).map(async (profile) => {
          try {
            const inbox = await cachedInbox(profile, req.query.refresh === '1')
            threads.push(
              ...inbox.threads.map((thread) => ({
                ...thread,
                profileId: profile.id,
                profileName: profile.name,
                viewerId: inbox.viewerId,
              })),
            )
          } catch {
            errors.push({ profileName: profile.name, message: 'Could not load inbox' })
          }
        }),
      )
    }
    res.json({ threads, errors })
  },
  'json',
)

async function client(profileId: unknown): Promise<InstagramChat> {
  const profile = await selectedProfile(profileId)
  try {
    return await InstagramChat.load(profile)
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'Connect this profile to Instagram Chat first'
    ) {
      throw new ValidationError(error.message)
    }
    throw error
  }
}

async function selectedProfile(profileId: unknown) {
  if (typeof profileId !== 'string' || !profileId.trim())
    throw new ValidationError('Select a profile')
  const profile = await profilesGetById(profileId)
  if (!profile) throw new NotFoundError('Profile not found')
  return profile
}

function threadId(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,40}$/.test(value))
    throw new ValidationError('Invalid thread ID')
  return value
}

function messageContext(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new ValidationError('Invalid Chat message ID')
  }
  return value
}

function originalMessageContext(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined
  if (
    typeof value !== 'string' ||
    value.length > 256 ||
    [...value].some(
      (character) => character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f,
    )
  ) {
    throw new ValidationError('Invalid original message context')
  }
  return value
}

function videoMetadata(query: Record<string, unknown>): VideoMetadata {
  const width = Number(query.width)
  const height = Number(query.height)
  const duration = Number(query.duration)
  if (
    !Number.isInteger(width) ||
    width < 1 ||
    width > 8192 ||
    !Number.isInteger(height) ||
    height < 1 ||
    height > 8192 ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 300
  ) {
    throw new ValidationError('Could not read video dimensions or duration')
  }
  return { width, height, duration }
}

function instagramError(error: unknown): never {
  const name = error instanceof Error ? error.name : ''
  if (name === 'IgLoginBadPasswordError' || name === 'IgLoginInvalidUserError') {
    throw new ValidationError('Instagram username or password is incorrect')
  }
  if (name === 'IgLoginTwoFactorRequiredError') {
    throw new ValidationError('Instagram requires two-factor verification')
  }
  if (error instanceof Error && error.message === 'Instagram CAA rejected the verification code') {
    throw new ValidationError('Instagram did not accept the authenticator code')
  }
  if (
    error instanceof Error &&
    error.message === 'Instagram requested email verification; authenticator codes are supported'
  ) {
    throw new ValidationError(error.message)
  }
  if (
    error instanceof Error &&
    error.message.startsWith('Instagram Chat could not connect through the profile proxy')
  ) {
    throw new ExternalServiceError(error.message)
  }
  if (error instanceof Error && error.message === 'ffmpeg is required to send voice messages') {
    throw new ExternalServiceError(error.message)
  }
  if (
    error instanceof Error &&
    /^(Instagram mobile|Instagram media upload|Instagram CAA|Instagram rejected CAA|Instagram did not provide|Instagram returned an invalid CAA)/.test(
      error.message,
    )
  ) {
    throw new ExternalServiceError(error.message)
  }
  if (/Login|Challenge|Checkpoint|TwoFactor/i.test(name)) {
    throw new ExternalServiceError('Instagram requires a new Chat login or account verification')
  }
  if (error instanceof InstagramError) {
    const status = error.status
    throw new ExternalServiceError(error.message || `Instagram DM request HTTP ${status}`)
  }
  throw new ExternalServiceError('Instagram DM request failed')
}

commands.register(
  'chat.get.profileId_session',
  'GET',
  '/:profileId/session',
  async (req, res) => {
    const profile = await selectedProfile(req.params.profileId)
    res.json({ connected: await InstagramChat.hasSession(profile.id) })
  },
  'json',
)

commands.register(
  'chat.post.profileId_session',
  'POST',
  '/:profileId/session',
  async (req, res) => {
    const profile = await selectedProfile(req.params.profileId)
    const credentials = parseChatCredentials(req.body?.credentials)
    if (!credentials) throw new ValidationError('Enter username:password:authenticator key')
    if (!profile.igLoggedIn || profile.status === 'deleting') {
      throw new ValidationError('Turn on Logged in for this profile')
    }
    try {
      await InstagramChat.login(
        profile,
        credentials.username,
        credentials.password,
        credentials.authenticatorKey,
      )
      clearSyncFailures(profile.id)
      res.json({ connected: true })
    } catch (error) {
      instagramError(error)
    }
  },
  'json',
)

commands.register(
  'chat.delete.profileId_session',
  'DELETE',
  '/:profileId/session',
  async (req, res) => {
    const profile = await selectedProfile(req.params.profileId)
    await InstagramChat.logout(profile.id)
    clearSyncFailures(profile.id)
    res.json({ connected: false })
  },
  'json',
)

commands.register(
  'chat.get.profileId_threads',
  'GET',
  '/:profileId/threads',
  async (req, res) => {
    const profile = await selectedProfile(req.params.profileId)
    const inbox = await cachedInbox(profile, req.query.refresh === '1').catch(instagramError)
    if (!inbox.connected) throw new ValidationError('Connect this profile to Instagram Chat first')
    res.json(inbox)
  },
  'json',
)

commands.register(
  'chat.get.profileId_threads_threadId',
  'GET',
  '/:profileId/threads/:threadId',
  async (req, res) => {
    const id = threadId(req.params.threadId)
    const profile = await selectedProfile(req.params.profileId)
    try {
      res.json(await cachedThread(profile, id, req.query.refresh === '1'))
    } catch (error) {
      instagramError(error)
    }
  },
  'json',
)

commands.register(
  'chat.get.profileId_threads_threadId_older',
  'GET',
  '/:profileId/threads/:threadId/older',
  async (req, res) => {
    const id = threadId(req.params.threadId)
    const before = Number(req.query.before)
    const beforeId = req.query.beforeId
    const cursor = req.query.cursor
    if (
      !Number.isFinite(before) ||
      before <= 0 ||
      (beforeId !== undefined && (typeof beforeId !== 'string' || beforeId.length > 100)) ||
      (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 2000))
    ) {
      throw new ValidationError('Invalid Chat history cursor')
    }
    const chat = await client(req.params.profileId)
    const messages = new Map<string, ChatThread['messages'][number]>()
    let nextCursor = cursor ?? ''
    let hasOlder = true
    const seenCursors = new Set([nextCursor])
    // A browser may have 30 cached messages. Skip those pages without storing old history in Convex.
    for (let pageCount = 0; pageCount < 6 && hasOlder && messages.size < 10; pageCount++) {
      const pageCursor = nextCursor
      const page = await chat.conversationPage(id, pageCursor).catch(instagramError)
      const ordered = [...page.thread.messages].sort((a, b) => b.timestamp - a.timestamp)
      const boundaryIndex = ordered.findIndex((message) => message.id === beforeId)
      const candidates = (boundaryIndex >= 0 ? ordered.slice(boundaryIndex + 1) : ordered).filter(
        (message) =>
          (boundaryIndex >= 0 || message.timestamp < before) && !messages.has(message.id),
      )
      const remaining = 10 - messages.size
      for (const message of candidates.slice(0, remaining)) messages.set(message.id, message)
      if (candidates.length > remaining) {
        // Revisit this page with the new message boundary so no items are skipped.
        nextCursor = pageCursor
        hasOlder = true
        break
      }
      hasOlder = page.hasOlder
      nextCursor = page.nextCursor
      if (hasOlder) {
        if (seenCursors.has(nextCursor))
          throw new ExternalServiceError('Instagram DM thread cursor repeated')
        seenCursors.add(nextCursor)
      }
    }
    res.json({
      messages: [...messages.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, 10),
      nextCursor,
      hasOlder,
    })
  },
  'json',
)

commands.register(
  'chat.post.profileId_threads_threadId_reply',
  'POST',
  '/:profileId/threads/:threadId/reply',
  async (req, res) => {
    const id = threadId(req.params.threadId)
    const text = req.body?.text
    if (typeof text !== 'string' || !text.trim() || text.length > 1000) {
      throw new ValidationError('Reply must contain 1 to 1000 characters')
    }
    const clientContext = messageContext(req.body?.clientContext)
    const chat = await client(req.params.profileId)
    let message: ChatThread['messages'][number]
    try {
      message = await chat.reply(id, text.trim(), clientContext)
    } catch (error) {
      instagramError(error)
    }
    res.json({ success: true, message })
    refreshAfterSend(String(req.params.profileId), id)
  },
  'json',
)

function refreshAfterSend(profileId: string, id: string): void {
  // Instagram accepted the DM. Cache work must not delay or fail the send response.
  void (async () => {
    invalidateChatSnapshots(profileId, id)
    try {
      // Only a thread fetch can confirm a reply; the broadcast response may be transient.
      await threadSyncs.get(`${profileId}:${id}`)?.catch(() => {})
      await syncThread(await selectedProfile(profileId), id)
    } catch (err) {
      logger.error({
        event: 'chat.routes.refresh_chat_after_sent_dm',
        error: err,
        profileId,
        threadId: id,
        message: 'Could not refresh Chat after sent DM',
        outcome: 'error',
      })
    }
  })()
}

commands.register(
  'chat.post.profileId_threads_threadId_attachment',
  'POST',
  '/:profileId/threads/:threadId/attachment',
  async (req, res) => {
    const id = threadId(req.params.threadId)
    const kind = req.query.kind
    if (kind !== 'photo' && kind !== 'video' && kind !== 'voice') {
      throw new ValidationError('Choose a photo, video, or voice message')
    }
    const clientContext = messageContext(req.query.clientContext)
    const video = kind === 'video' ? videoMetadata(req.query) : undefined
    const chat = await client(req.params.profileId)
    let message: ChatThread['messages'][number]
    const controller = new AbortController()
    const abort = () => controller.abort()
    req.once('aborted', abort)
    res.once('close', abort)
    let file: Awaited<ReturnType<typeof stageAttachment>> | undefined
    try {
      file = await stageAttachment(req, kind, controller.signal)
      try {
        message = await chat.sendAttachment(id, kind as AttachmentKind, file, clientContext, video)
      } catch (error) {
        if (error instanceof ValidationError) throw error
        instagramError(error)
      }
    } finally {
      req.removeListener('aborted', abort)
      res.removeListener('close', abort)
      if (file) await removeAttachment(file).catch(() => {})
    }
    res.json({ success: true, message })
    refreshAfterSend(String(req.params.profileId), id)
  },
  'stream',
)

commands.register(
  'chat.post.profileId_threads_threadId_reaction',
  'POST',
  '/:profileId/threads/:threadId/reaction',
  async (req, res) => {
    const id = threadId(req.params.threadId)
    const itemId = threadId(req.body?.messageId)
    const kind = req.body?.kind
    const emoji = req.body?.emoji
    if (
      typeof kind !== 'string' ||
      !/^[a-z0-9_]{1,40}$/i.test(kind) ||
      typeof emoji !== 'string' ||
      !emoji.trim() ||
      emoji.length > 16 ||
      typeof req.body?.remove !== 'boolean'
    ) {
      throw new ValidationError('Invalid reaction')
    }
    const clientContext = originalMessageContext(req.body?.clientContext)
    const chat = await client(req.params.profileId)
    try {
      await chat.react(id, { id: itemId, kind, clientContext }, emoji, req.body.remove)
    } catch (error) {
      instagramError(error)
    }
    res.json({ success: true })
    void (async () => {
      try {
        await threadSyncs.get(`${req.params.profileId}:${id}`)?.catch(() => {})
        await syncThread(await selectedProfile(req.params.profileId), id)
      } catch (err) {
        logger.error({
          event: 'chat.routes.refresh_chat_after_reaction',
          error: err,
          profileId: req.params.profileId,
          threadId: id,
          message: 'Could not refresh Chat after reaction',
          outcome: 'error',
        })
      }
    })()
  },
  'json',
)

commands.register(
  'chat.post.profileId_threads_threadId_unsend',
  'POST',
  '/:profileId/threads/:threadId/unsend',
  async (req, res) => {
    const id = threadId(req.params.threadId)
    const itemId = threadId(req.body?.messageId)
    const profileId = String(req.params.profileId)
    const chat = await client(profileId)
    try {
      await chat.unsend(id, itemId)
    } catch (error) {
      instagramError(error)
    }
    // Instagram already removed the message. A cache failure must not report that unsend failed.
    const affected = await chatMarkUnsent(profileId, chat.cacheToken, id, itemId).catch((err) => {
      logger.error({
        event: 'chat.routes.mark_unsent_chat_message',
        error: err,
        profileId,
        threadId: id,
        itemId,
        message: 'Could not mark unsent Chat message',
        outcome: 'error',
      })
      return { profileIds: [profileId] }
    })
    for (const affectedProfileId of affected.profileIds)
      invalidateChatSnapshots(affectedProfileId, id)
    res.json({ success: true })
    void (async () => {
      try {
        await threadSyncs.get(`${profileId}:${id}`)?.catch(() => {})
        await syncThread(await selectedProfile(profileId), id)
      } catch (err) {
        logger.error({
          event: 'chat.routes.refresh_chat_after_unsend',
          error: err,
          profileId,
          threadId: id,
          message: 'Could not refresh Chat after unsend',
          outcome: 'error',
        })
      }
    })()
  },
  'json',
)

export default commands
