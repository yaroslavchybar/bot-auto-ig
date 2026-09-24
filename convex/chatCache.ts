import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation, internalQuery, query, type MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';

const reaction = v.object({ senderId: v.string(), emoji: v.string() });
const message = v.object({ id: v.string(), senderId: v.string(), text: v.string(),
  timestamp: v.number(), kind: v.string(), clientContext: v.optional(v.string()),
  mediaType: v.optional(v.union(v.literal('photo'), v.literal('video'), v.literal('voice'))),
  mediaUrl: v.optional(v.string()), reactions: v.optional(v.array(reaction)) });
const user = v.object({ id: v.string(), username: v.string() });
const seen = v.object({ userId: v.string(), timestamp: v.number() });
const thread = v.object({ id: v.string(), title: v.string(), users: v.array(user),
  messages: v.array(message), lastSeenAt: v.array(seen) });

type ChatMessage = { id: string; senderId: string; text: string; timestamp: number; kind: string;
  clientContext?: string; mediaType?: 'photo' | 'video' | 'voice'; mediaUrl?: string;
  reactions?: { senderId: string; emoji: string }[] };

// Read receipts never clear our reply queue. Outgoing messages advance its watermark.
function unreadFields(existing: Doc<'chatThreads'> | null, messages: ChatMessage[], viewerId: string) {
  const lastIncomingAt = Math.max(existing?.lastIncomingAt ?? 0, ...messages
    .filter(item => viewerId && item.senderId && item.senderId !== viewerId)
    .map(item => item.timestamp));
  const repliedThroughAt = Math.max(existing?.repliedThroughAt ?? 0, ...messages
    .filter(item => viewerId && item.senderId === viewerId).map(item => item.timestamp));
  return { lastIncomingAt, repliedThroughAt, unread: lastIncomingAt > repliedThroughAt };
}

// One small counter per connected profile; never read histories for the sidebar.
export const unreadCount = query({
  args: {},
  handler: async ctx => {
    const sessions = await ctx.db.query('chatSessions').collect();
    let count = 0;
    for (const session of sessions) {
      if (!session.unreadCount) continue;
      const profile = await ctx.db.get(session.profileId);
      if (profile?.igLoggedIn && profile.status !== 'deleting') count += session.unreadCount;
    }
    return count;
  },
});

export const markReplied = internalMutation({
  args: { profileId: v.id('profiles'), token: v.string(), threadId: v.string(), throughAt: v.number() },
  handler: async (ctx, { profileId, token, threadId, throughAt }) => {
    const session = await ctx.db.query('chatSessions').withIndex('by_profile', q => q.eq('profileId', profileId)).unique();
    if (!session || session.token !== token) throw new Error('Chat session changed');
    const row = await ctx.db.query('chatThreads').withIndex('by_profile_session_thread', q =>
      q.eq('profileId', profileId).eq('sessionToken', token).eq('threadId', threadId)).unique();
    if (!row) throw new Error('Chat conversation is missing');
    const repliedThroughAt = Math.max(row.repliedThroughAt ?? 0, throughAt);
    const unread = (row.lastIncomingAt ?? 0) > repliedThroughAt;
    await ctx.db.patch(row._id, { repliedThroughAt, unread });
    if (unread !== (row.unread ?? false)) await ctx.db.patch(session._id, {
      unreadCount: Math.max(0, (session.unreadCount ?? 0) + Number(unread) - Number(row.unread ?? false)),
    });
  },
});

export const markUnsent = internalMutation({
  args: { profileId: v.id('profiles'), token: v.string(), threadId: v.string(), messageId: v.string() },
  handler: async (ctx, { profileId, token, threadId, messageId }) => {
    const session = await ctx.db.query('chatSessions').withIndex('by_profile', q => q.eq('profileId', profileId)).unique();
    if (!session || session.token !== token) throw new Error('Chat session changed');
    const row = await ctx.db.query('chatThreads').withIndex('by_profile_session_thread', q =>
      q.eq('profileId', profileId).eq('sessionToken', token).eq('threadId', threadId)).unique();
    const history = await ctx.db.query('chatHistories').withIndex('by_profile_session_thread', q =>
      q.eq('profileId', profileId).eq('sessionToken', token).eq('threadId', threadId)).unique();
    const messages = history?.messages.filter(item => item.id !== messageId) ?? [];
    if (history && messages.length !== history.messages.length) await ctx.db.patch(history._id, { messages });
    const unsentMessageIds = [...new Set([...(row?.unsentMessageIds ?? []), messageId])].slice(-100);
    if (row) await ctx.db.patch(row._id, { unsentMessageIds,
      preview: row.preview?.id === messageId ? messages[0] : row.preview });
    else await ctx.db.insert('chatThreads', { profileId, sessionToken: token, threadId,
      title: 'Conversation', users: [], lastSeenAt: [], unsentMessageIds });
  },
});

function mergeMessages(previous: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(previous.map(item => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
}

function reconcileMessages(previous: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return [];
  const oldest = Math.min(...incoming.map(item => item.timestamp));
  return mergeMessages(previous.filter(item => item.timestamp < oldest), incoming);
}

function mergeSeen(previous: { userId: string; timestamp: number }[],
  incoming: { userId: string; timestamp: number }[]): { userId: string; timestamp: number }[] {
  const byUser = new Map(previous.map(item => [item.userId, item.timestamp]));
  for (const item of incoming) byUser.set(item.userId,
    Math.max(byUser.get(item.userId) ?? 0, item.timestamp));
  return [...byUser].map(([userId, timestamp]) => ({ userId, timestamp }));
}

// Bound cleanup work and isolate it from any replacement session.
async function clearSessionCache(ctx: MutationCtx, profileId: Id<'profiles'>, token: string): Promise<void> {
  let more = false;
  for (const table of ['chatThreads', 'chatHistories'] as const) {
    const rows = await ctx.db.query(table).withIndex('by_profile_session_thread', q =>
      q.eq('profileId', profileId).eq('sessionToken', token)).take(25);
    for (const row of rows) await ctx.db.delete(row._id);
    more ||= rows.length === 25;
  }
  if (more) await ctx.scheduler.runAfter(0, internal.chatCache.clearSession, { profileId, token });
}

export const clearSession = internalMutation({
  args: { profileId: v.id('profiles'), token: v.string() },
  handler: async (ctx, { profileId, token }): Promise<void> => clearSessionCache(ctx, profileId, token),
});

export async function clearProfileChatCache(ctx: MutationCtx, profileId: Id<'profiles'>): Promise<void> {
  const session = await ctx.db.query('chatSessions')
    .withIndex('by_profile', q => q.eq('profileId', profileId)).unique();
  if (session) await clearSessionCache(ctx, profileId, session.token);
}

export const inbox = internalQuery({
  args: { profileId: v.id('profiles') },
  handler: async (ctx, { profileId }) => {
    const session = await ctx.db.query('chatSessions')
      .withIndex('by_profile', q => q.eq('profileId', profileId)).first();
    if (!session) return { connected: false, viewerId: '', threads: [], syncedAt: 0 };
    // Read summaries only; conversation histories stay in their own table.
    const rows = await Promise.all((session.inboxThreadIds ?? []).map(threadId =>
      ctx.db.query('chatThreads').withIndex('by_profile_session_thread', q =>
        q.eq('profileId', profileId).eq('sessionToken', session.token).eq('threadId', threadId)).unique()));
    return { connected: true, viewerId: session.viewerId ?? '', syncedAt: session.inboxSyncedAt ?? 0,
      threads: rows.flatMap(row => row ? [{ id: row.threadId, title: row.title, users: row.users,
        messages: row.preview ? [row.preview] : [], lastSeenAt: row.lastSeenAt, unread: row.unread ?? false }] : [])
        .sort((a, b) => (b.messages[0]?.timestamp ?? 0) - (a.messages[0]?.timestamp ?? 0)) };
  },
});

export const conversation = internalQuery({
  args: { profileId: v.id('profiles'), threadId: v.string() },
  handler: async (ctx, { profileId, threadId }) => {
    const session = await ctx.db.query('chatSessions')
      .withIndex('by_profile', q => q.eq('profileId', profileId)).first();
    if (!session) return null;
    const row = await ctx.db.query('chatThreads')
      .withIndex('by_profile_session_thread', q => q.eq('profileId', profileId)
        .eq('sessionToken', session.token).eq('threadId', threadId)).unique();
    if (!row || row.sessionToken !== session.token) return null;
    const history = await ctx.db.query('chatHistories').withIndex('by_profile_session_thread', q =>
      q.eq('profileId', profileId).eq('sessionToken', session.token).eq('threadId', threadId)).unique();
    return { id: row.threadId, title: row.title, users: row.users,
      messages: mergeMessages(history?.messages ?? [], row.preview ? [row.preview] : []),
      lastSeenAt: row.lastSeenAt, syncedAt: row.threadSyncedAt ?? 0, unread: row.unread ?? false };
  },
});

export const saveInbox = internalMutation({
  args: { profileId: v.id('profiles'), token: v.string(), viewerId: v.string(),
    threads: v.array(thread), mode: v.optional(v.union(v.literal('full'), v.literal('unread'))) },
  handler: async (ctx, { profileId, token, viewerId, threads, mode = 'full' }) => {
    if (threads.some(item => item.messages.length > 1)) throw new Error('Inbox needs only one preview per thread');
    const session = await ctx.db.query('chatSessions')
      .withIndex('by_profile', q => q.eq('profileId', profileId)).first();
    if (!session || session.token !== token) throw new Error('Chat session changed');
    let unreadCount = session.unreadCount ?? 0;
    const savedThreads = [];
    for (const item of threads) {
      const existing = await ctx.db.query('chatThreads')
        .withIndex('by_profile_session_thread', q => q.eq('profileId', profileId)
          .eq('sessionToken', token).eq('threadId', item.id)).unique();
      const unsent = new Set(existing?.unsentMessageIds ?? []);
      const preview = item.messages[0] && !unsent.has(item.messages[0].id)
        ? item.messages[0] : item.messages.length ? existing?.preview : undefined;
      const lastSeenAt = mergeSeen(existing?.sessionToken === token ? existing.lastSeenAt : [], item.lastSeenAt);
      const unread = unreadFields(existing, preview ? [preview] : [], viewerId);
      unreadCount += Number(unread.unread) - Number(existing?.unread ?? false);
      savedThreads.push({ ...item, messages: preview ? [preview] : [], lastSeenAt, unread: unread.unread });
      const fields = { sessionToken: token, title: item.title, users: item.users,
        ...unread,
        lastSeenAt, preview,
        ...(existing?.sessionToken !== token ? { threadSyncedAt: undefined } : {}) };
      if (existing && existing.unread === unread.unread && existing.lastIncomingAt === unread.lastIncomingAt &&
        existing.repliedThroughAt === unread.repliedThroughAt && existing.title === item.title &&
        JSON.stringify(existing.preview) === JSON.stringify(preview) &&
        JSON.stringify(existing.users) === JSON.stringify(item.users) &&
        JSON.stringify(existing.lastSeenAt) === JSON.stringify(lastSeenAt)) continue;
      if (existing) await ctx.db.patch(existing._id, fields);
      else await ctx.db.insert('chatThreads', { profileId, threadId: item.id, ...fields });
    }
    const syncedAt = Date.now();
    const incomingIds = threads.map(item => item.id);
    // An unread-filtered response is only a subset; keep the read threads already cached.
    const inboxThreadIds = mode === 'unread'
      ? [...new Set([...incomingIds, ...(session.inboxThreadIds ?? [])])]
      : [...new Set(incomingIds)];
    await ctx.db.patch(session._id, { viewerId, unreadCount, inboxSyncedAt: syncedAt,
      inboxThreadIds });
    if (mode === 'unread') {
      const fetchedIds = new Set(incomingIds);
      const retained = await Promise.all(inboxThreadIds.filter(id => !fetchedIds.has(id)).map(threadId =>
        ctx.db.query('chatThreads').withIndex('by_profile_session_thread', q =>
          q.eq('profileId', profileId).eq('sessionToken', token).eq('threadId', threadId)).unique()));
      savedThreads.push(...retained.flatMap(row => row ? [{ id: row.threadId, title: row.title, users: row.users,
        messages: row.preview ? [row.preview] : [], lastSeenAt: row.lastSeenAt, unread: row.unread ?? false }] : []));
    }
    return { connected: true, viewerId,
      threads: savedThreads.sort((a, b) => (b.messages[0]?.timestamp ?? 0) - (a.messages[0]?.timestamp ?? 0)), syncedAt };
  },
});

export const saveConversation = internalMutation({
  args: { profileId: v.id('profiles'), token: v.string(), thread },
  handler: async (ctx, { profileId, token, thread: item }) => {
    if (item.messages.length > 100) throw new Error('Too many Chat messages');
    const session = await ctx.db.query('chatSessions')
      .withIndex('by_profile', q => q.eq('profileId', profileId)).first();
    if (!session || session.token !== token) throw new Error('Chat session changed');
    const existing = await ctx.db.query('chatThreads')
      .withIndex('by_profile_session_thread', q => q.eq('profileId', profileId)
        .eq('sessionToken', token).eq('threadId', item.id)).unique();
    const history = await ctx.db.query('chatHistories').withIndex('by_profile_session_thread', q =>
      q.eq('profileId', profileId).eq('sessionToken', token).eq('threadId', item.id)).unique();
    const unsent = new Set(existing?.unsentMessageIds ?? []);
    const incoming = item.messages.filter(message => !unsent.has(message.id));
    const fetchedMessages = incoming.length || item.messages.length === 0
      ? reconcileMessages(history?.messages ?? [], incoming)
      : history?.messages.filter(message => !unsent.has(message.id)) ?? [];
    // An inbox sync may have saved a newer DM while this thread request was in flight.
    const newerPreview = existing?.preview &&
      existing.preview.timestamp > (fetchedMessages[0]?.timestamp ?? -Infinity) ? existing.preview : undefined;
    const messages = newerPreview ? mergeMessages(fetchedMessages, [newerPreview]) : fetchedMessages;
    const unread = unreadFields(existing, messages, session.viewerId ?? '');
    const historyChanged = !history || JSON.stringify(history.messages) !== JSON.stringify(messages);
    if (!history) await ctx.db.insert('chatHistories', { profileId, threadId: item.id, sessionToken: token, messages });
    else if (historyChanged) await ctx.db.patch(history._id, { messages });
    const lastSeenAt = mergeSeen(existing?.sessionToken === token ? existing.lastSeenAt : [], item.lastSeenAt);
    const fields = { sessionToken: token, title: item.title, users: item.users,
      ...unread,
      preview: messages[0],
      lastSeenAt,
      threadSyncedAt: Date.now() };
    const threadChanged = !existing || historyChanged || existing.title !== item.title ||
      existing.unread !== unread.unread || existing.lastIncomingAt !== unread.lastIncomingAt ||
      existing.repliedThroughAt !== unread.repliedThroughAt ||
      JSON.stringify(existing.preview) !== JSON.stringify(fields.preview) ||
      JSON.stringify(existing.users) !== JSON.stringify(item.users) ||
      JSON.stringify(existing.lastSeenAt) !== JSON.stringify(lastSeenAt);
    if (!existing) await ctx.db.insert('chatThreads', { profileId, threadId: item.id, ...fields });
    else if (threadChanged) await ctx.db.patch(existing._id, fields);
    if (unread.unread !== (existing?.unread ?? false)) await ctx.db.patch(session._id, {
      unreadCount: (session.unreadCount ?? 0) + Number(unread.unread) - Number(existing?.unread ?? false),
    });
    return { ...item, messages, lastSeenAt, syncedAt: threadChanged ? fields.threadSyncedAt : existing?.threadSyncedAt ?? 0,
      unread: unread.unread };
  },
});
