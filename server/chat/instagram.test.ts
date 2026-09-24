import { expect, test } from 'bun:test';
import { fetchChatInboxPages, parseChatInboxThread, parseChatThread } from './instagram.js';

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

test('DM inbox keeps only the latest preview when Instagram returns extra items', () => {
  const raw = { thread_id: '123', items: [
    { item_id: 'old', user_id: 'friend', text: 'Old', timestamp: '1700000000000000' },
    { item_id: 'new', user_id: 'friend', text: 'New', timestamp: '1700000001000000' },
  ] };
  expect(parseChatInboxThread(raw).messages.map(item => item.id)).toEqual(['new']);
  expect(parseChatThread(raw).messages.map(item => item.id)).toEqual(['old', 'new']);
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
