import { expect, test } from 'bun:test';
import { fetchChatInboxPages, fetchRecentProfilePosts, parseChatInboxThread, parseChatMessagePage, parseChatThread } from './instagram.js';
import type { UserFeedResponseItemsItem } from 'instagram-private-api';

test('DM thread keeps Instagram read receipts in message timestamp units', () => {
  const thread = parseChatThread({
    thread_id: '123', thread_title: 'Friend',
    users: [{ pk: 'friend', username: 'friend' }],
    items: [{ item_id: '456', user_id: 'viewer', text: 'Hello', client_context: 'reply-token',
      timestamp: '1700000000000000', item_type: 'text' }],
    last_seen_at: { friend: { item_id: '456', timestamp: '1700000000000000' } },
  });
  expect(thread.messages[0].timestamp).toBe(1700000000000);
  expect(thread.messages[0].clientContext).toBe('reply-token');
  expect(thread.lastSeenAt).toEqual([{ userId: 'friend', timestamp: 1700000000000 }]);
});

test('DM thread exposes media URLs and emoji reactions', () => {
  const thread = parseChatThread({ thread_id: '123', items: [
    { item_id: 'photo', user_id: 'friend', timestamp: '1700000000000000', item_type: 'photo_attachment',
      media: { image_versions2: { candidates: [{ url: 'https://cdn.example/photo.jpg' }] } },
      reactions: { emojis: [{ sender_id: 'viewer', emoji: '❤️' }] } },
    { item_id: 'voice', user_id: 'friend', timestamp: '1700000001000000', item_type: 'voice_media',
      voice_media: { media: { audio: { audio_src: 'https://cdn.example/voice.m4a' } } } },
    { item_id: 'video', user_id: 'friend', timestamp: '1700000002000000', item_type: 'raven_media',
      visual_media: { media: { media_type: 2,
        video_versions: [{ url: 'https://cdn.example/video.mp4' }] } } },
  ] });
  expect(thread.messages.map(item => [item.mediaType, item.mediaUrl])).toEqual([
    ['photo', 'https://cdn.example/photo.jpg'],
    ['voice', 'https://cdn.example/voice.m4a'],
    ['video', 'https://cdn.example/video.mp4'],
  ]);
  expect(thread.messages[0].reactions).toEqual([{ senderId: 'viewer', emoji: '❤️' }]);
  expect(thread.messages[0].clientContext).toBeUndefined();
});

test('DM inbox keeps only the latest preview when Instagram returns extra items', () => {
  const raw = { thread_id: '123', items: [
    { item_id: 'old', user_id: 'friend', text: 'Old', timestamp: '1700000000000000' },
    { item_id: 'new', user_id: 'friend', text: 'New', timestamp: '1700000001000000' },
  ] };
  expect(parseChatInboxThread(raw).messages.map(item => item.id)).toEqual(['new']);
  expect(parseChatThread(raw).messages.map(item => item.id)).toEqual(['old', 'new']);
});

test('DM thread page exposes the older cursor and rejects a missing continuation', () => {
  const page = parseChatMessagePage({ thread: { thread_id: '123', items: [],
    has_older: true, oldest_cursor: 'older-10' } });
  expect(page).toMatchObject({ nextCursor: 'older-10', hasOlder: true, thread: { id: '123' } });
  expect(() => parseChatMessagePage({ thread: { thread_id: '123', items: [], has_older: true } }))
    .toThrow('cursor is missing');
});

test('First DM inbox fetch takes the 30 most recent chats across pages', async () => {
  const queries: Record<string, string>[] = [];
  const rawThread = (id: number) => ({ thread_id: String(id), items: [
    { item_id: `message-${id}`, user_id: 'friend', text: String(id), timestamp: String(id * 1_000_000) },
  ] });
  const pages = [
    { inbox: { threads: Array.from({ length: 20 }, (_, i) => rawThread(i)), oldest_cursor: 'next', has_older: true } },
    { inbox: { threads: [rawThread(19), ...Array.from({ length: 11 }, (_, i) => rawThread(i + 20))],
      oldest_cursor: 'more', has_older: true } },
  ];
  const threads = await fetchChatInboxPages(async query => {
    queries.push(query);
    return pages[queries.length - 1];
  });
  expect(threads.map(thread => thread.id)).toEqual(Array.from({ length: 30 }, (_, i) => String(i)));
  expect(queries).toHaveLength(2);
  expect(queries[0].cursor).toBeUndefined();
  expect(queries[1]).toMatchObject({ cursor: 'next', direction: 'older', fetch_reason: 'page_scroll' });
});

test('Unread DM inbox fetch follows every page', async () => {
  const queries: Record<string, string>[] = [];
  const rawThread = (id: number) => ({ thread_id: String(id), items: [] });
  const pages = [
    { inbox: { threads: Array.from({ length: 20 }, (_, i) => rawThread(i)), oldest_cursor: 'next' } },
    { inbox: { threads: Array.from({ length: 15 }, (_, i) => rawThread(i + 20)), has_older: false } },
  ];
  const threads = await fetchChatInboxPages(async query => {
    queries.push(query);
    return pages[queries.length - 1];
  }, true);
  expect(threads).toHaveLength(35);
  expect(queries).toHaveLength(2);
  expect(queries.every(query => query.selected_filter === 'unread')).toBe(true);
});

test('DM inbox rejects an incomplete paginated snapshot', async () => {
  await expect(fetchChatInboxPages(async () => ({ inbox: { threads: [], has_older: true } })))
    .rejects.toThrow('cursor is missing');
});

const post = (id: number, date: number, pinned = false) => ({
  pk: String(id), code: `post_${id}`, taken_at: date,
  ...(pinned ? { timeline_pinned_user_ids: ['user'] } : {}),
}) as UserFeedResponseItemsItem;

function profileFeed(pages: UserFeedResponseItemsItem[][], cursor?: string) {
  let page = -1;
  return {
    items: async () => pages[++page]!,
    isMoreAvailable: () => page < pages.length - 1,
    toPlain: () => ({ nextMaxId: cursor ?? String(page) }),
  };
}

test('old pinned posts do not hide recent posts or stop pagination', async () => {
  let heartbeats = 0;
  const result = await fetchRecentProfilePosts(profileFeed([
    [post(1, 10, true), post(2, 300)],
    [post(2, 300), post(3, 200), post(4, 10)],
    [post(5, 5)],
  ]), 100_000, 10, async () => { heartbeats++; });
  expect(result).toEqual([{ id: '2', code: 'post_2' }, { id: '3', code: 'post_3' }]);
  expect(heartbeats).toBe(2);
});

test('native post limit stops further page requests', async () => {
  let heartbeats = 0;
  expect(await fetchRecentProfilePosts(profileFeed([
    [post(1, 300), post(2, 200)], [post(3, 100)],
  ]), 100_000, 1, async () => { heartbeats++; })).toEqual([{ id: '1', code: 'post_1' }]);
  expect(heartbeats).toBe(1);
});

test('native posts reject malformed data and repeated pagination cursors', async () => {
  await expect(fetchRecentProfilePosts(profileFeed([[post(1, NaN)]]), 0, 10)).rejects.toThrow('without a date');
  await expect(fetchRecentProfilePosts(profileFeed([[], [post(1, 100)]]), 0, 10)).rejects.toThrow('incomplete');
  await expect(fetchRecentProfilePosts(profileFeed([
    [post(1, 300)], [post(1, 300)], [post(2, 200)],
  ], 'same'), 0, 10)).rejects.toThrow('cursor is missing or repeated');
});
