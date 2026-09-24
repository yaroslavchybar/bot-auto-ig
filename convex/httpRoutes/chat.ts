import type { HttpRouter } from 'convex/server';
import type { Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { jsonResponse, parseBody, registerPreflight, ValidationError, withErrorHandling } from './shared';

const profileIdFrom = (value: unknown): Id<'profiles'> => {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError('Profile ID is required');
  return value as Id<'profiles'>;
};

export function registerChatRoutes(http: HttpRouter): void {
  registerPreflight(http, ['/api/chat/session', '/api/chat/cache']);
  http.route({ path: '/api/chat/cache', method: 'GET', handler: withErrorHandling(async (ctx, request) => {
    const query = new URL(request.url).searchParams;
    const profileId = profileIdFrom(query.get('profileId'));
    const threadId = query.get('threadId');
    return jsonResponse(threadId
      ? await ctx.runQuery(internal.chatCache.conversation, { profileId, threadId })
      : await ctx.runQuery(internal.chatCache.inbox, { profileId }));
  }) });

  http.route({ path: '/api/chat/cache', method: 'POST', handler: withErrorHandling(async (ctx, request) => {
    const body = await parseBody(request);
    const profileId = profileIdFrom(body.profileId);
    if (typeof body.token !== 'string') throw new ValidationError('Chat session token is required');
    if (body.scope === 'inbox') {
      if (body.mode !== undefined && body.mode !== 'full' && body.mode !== 'unread') {
        throw new ValidationError('Invalid Chat inbox mode');
      }
      return jsonResponse(await ctx.runMutation(internal.chatCache.saveInbox, {
        profileId, token: body.token, viewerId: body.viewerId, threads: body.threads, mode: body.mode,
      }));
    } else if (body.scope === 'thread') {
      return jsonResponse(await ctx.runMutation(internal.chatCache.saveConversation, {
        profileId, token: body.token, thread: body.thread,
      }));
    } else if (body.scope === 'replied') {
      await ctx.runMutation(internal.chatCache.markReplied, {
        profileId, token: body.token, threadId: body.threadId, throughAt: body.throughAt,
      });
    } else if (body.scope === 'unsent') {
      if (typeof body.threadId !== 'string' || !/^\d{1,40}$/.test(body.threadId) ||
        typeof body.messageId !== 'string' || !/^\d{1,40}$/.test(body.messageId)) {
        throw new ValidationError('Invalid Chat message ID');
      }
      await ctx.runMutation(internal.chatCache.markUnsent, {
        profileId, token: body.token, threadId: body.threadId, messageId: body.messageId,
      });
    } else throw new ValidationError('Invalid Chat cache scope');
    return jsonResponse({ saved: true });
  }) });
  http.route({ path: '/api/chat/session', method: 'GET', handler: withErrorHandling(async (ctx, request) => {
    const profileId = profileIdFrom(new URL(request.url).searchParams.get('profileId'));
    const row = await ctx.runQuery(internal.profiles.queries.getChatSessionInternal, { profileId });
    if (!row) return jsonResponse({ connected: false });
    if (new URL(request.url).searchParams.get('status') === '1') return jsonResponse({ connected: true });
    const blob = await ctx.storage.get(row.storageId);
    if (!blob) throw new Error('Chat session file is missing');
    return jsonResponse({ connected: true, state: await blob.text(), token: row.token });
  }) });

  http.route({ path: '/api/chat/session', method: 'POST', handler: withErrorHandling(async (ctx, request) => {
    const body = await parseBody(request);
    const profileId = profileIdFrom(body.profileId);
    if (typeof body.state !== 'string' || body.state.length > 250_000 ||
        typeof body.token !== 'string' || !/^[a-f\d-]{36}$/i.test(body.token) ||
        (body.expectedToken !== undefined && typeof body.expectedToken !== 'string')) {
      throw new ValidationError('Invalid Chat session');
    }
    const storageId = await ctx.storage.store(new Blob([body.state], { type: 'application/json' }));
    try {
      await ctx.runMutation(internal.profiles.mutations.saveChatSessionInternal, {
        profileId, storageId, token: body.token, expectedToken: body.expectedToken,
      });
      return jsonResponse({ connected: true });
    } catch (error) {
      await ctx.storage.delete(storageId);
      throw error;
    }
  }) });

  http.route({ path: '/api/chat/session', method: 'DELETE', handler: withErrorHandling(async (ctx, request) => {
    const profileId = profileIdFrom(new URL(request.url).searchParams.get('profileId'));
    await ctx.runMutation(internal.profiles.mutations.deleteChatSessionInternal, { profileId });
    return jsonResponse({ connected: false });
  }) });
}
