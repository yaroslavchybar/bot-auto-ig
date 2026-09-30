import { expect, test } from 'bun:test'
import {
  InstagramChat,
  InstagramError,
  parseChatInboxThread,
  parseChatMessagePage,
  parseChatThread,
} from './instagram.js'

test('mobile errors keep HTTP status for invalid JSON and preserve structured error details', async () => {
  let response = new Response(null, { status: 503 })
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => response,
  })
  const previousUrl = process.env.RUNTIME_URL
  process.env.RUNTIME_URL = `http://127.0.0.1:${server.port}`
  try {
    for (const [body, status] of [
      ['<html>Bad gateway</html>', 502],
      ['{"error":', 429],
      ['', 503],
      ['null', 500],
    ] as const) {
      response = new Response(body, { status })
      try {
        await InstagramChat.hasSession('profile')
        throw new Error('Expected an InstagramError')
      } catch (error) {
        expect(error).toBeInstanceOf(InstagramError)
        expect(error).toMatchObject({
          message: 'Instagram request failed',
          name: 'InstagramError',
          status,
          retryAfterMs: 0,
        })
      }
    }

    response = Response.json(
      {
        error: {
          message: 'Wait before retrying',
          name: 'IgRateLimitError',
          status: 429,
          retryAfterMs: 60_000,
        },
      },
      { status: 400 },
    )
    await expect(InstagramChat.hasSession('profile')).rejects.toMatchObject({
      message: 'Wait before retrying',
      name: 'IgRateLimitError',
      status: 429,
      retryAfterMs: 60_000,
    })

    response = Response.json({ connected: true })
    expect(await InstagramChat.hasSession('profile')).toBe(true)
    response = new Response('invalid success JSON')
    await expect(InstagramChat.hasSession('profile')).rejects.toBeInstanceOf(SyntaxError)
  } finally {
    if (previousUrl === undefined) delete process.env.RUNTIME_URL
    else process.env.RUNTIME_URL = previousUrl
    server.stop(true)
  }
})

test('DM thread keeps Instagram read receipts in message timestamp units', () => {
  const thread = parseChatThread({
    thread_id: '123',
    thread_title: 'Friend',
    users: [{ pk: 'friend', username: 'friend' }],
    items: [
      {
        item_id: '456',
        user_id: 'viewer',
        text: 'Hello',
        client_context: 'reply-token',
        timestamp: '1700000000000000',
        item_type: 'text',
      },
    ],
    last_seen_at: { friend: { item_id: '456', timestamp: '1700000000000000' } },
  })
  expect(thread.messages[0].timestamp).toBe(1700000000000)
  expect(thread.messages[0].clientContext).toBe('reply-token')
  expect(thread.lastSeenAt).toEqual([{ userId: 'friend', timestamp: 1700000000000 }])
})

test('DM thread exposes media URLs and emoji reactions', () => {
  const thread = parseChatThread({
    thread_id: '123',
    items: [
      {
        item_id: 'photo',
        user_id: 'friend',
        timestamp: '1700000000000000',
        item_type: 'photo_attachment',
        media: { image_versions2: { candidates: [{ url: 'https://cdn.example/photo.jpg' }] } },
        reactions: { emojis: [{ sender_id: 'viewer', emoji: '❤️' }] },
      },
      {
        item_id: 'voice',
        user_id: 'friend',
        timestamp: '1700000001000000',
        item_type: 'voice_media',
        voice_media: { media: { audio: { audio_src: 'https://cdn.example/voice.m4a' } } },
      },
      {
        item_id: 'video',
        user_id: 'friend',
        timestamp: '1700000002000000',
        item_type: 'raven_media',
        visual_media: {
          media: { media_type: 2, video_versions: [{ url: 'https://cdn.example/video.mp4' }] },
        },
      },
    ],
  })
  expect(thread.messages.map((item) => [item.mediaType, item.mediaUrl])).toEqual([
    ['photo', 'https://cdn.example/photo.jpg'],
    ['voice', 'https://cdn.example/voice.m4a'],
    ['video', 'https://cdn.example/video.mp4'],
  ])
  expect(thread.messages[0].reactions).toEqual([{ senderId: 'viewer', emoji: '❤️' }])
  expect(thread.messages[0].clientContext).toBeUndefined()
})

test('DM inbox keeps only the latest preview when Instagram returns extra items', () => {
  const raw = {
    thread_id: '123',
    items: [
      { item_id: 'old', user_id: 'friend', text: 'Old', timestamp: '1700000000000000' },
      { item_id: 'new', user_id: 'friend', text: 'New', timestamp: '1700000001000000' },
    ],
  }
  expect(parseChatInboxThread(raw).messages.map((item) => item.id)).toEqual(['new'])
  expect(parseChatThread(raw).messages.map((item) => item.id)).toEqual(['old', 'new'])
})

test('DM thread page exposes the older cursor and rejects a missing continuation', () => {
  const page = parseChatMessagePage({
    thread: { thread_id: '123', items: [], has_older: true, oldest_cursor: 'older-10' },
  })
  expect(page).toMatchObject({ nextCursor: 'older-10', hasOlder: true, thread: { id: '123' } })
  expect(() =>
    parseChatMessagePage({ thread: { thread_id: '123', items: [], has_older: true } }),
  ).toThrow('cursor is missing')
})
