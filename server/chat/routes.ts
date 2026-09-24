import { Router } from 'express';
import { IgResponseError } from 'instagram-private-api';
import { chatMarkReplied, profilesGetById, profilesList } from '../shared/convexClient.js';
import { cachedInbox, cachedThread, clearSyncFailures, syncThread, threadSyncs } from './sync.js';
import { asyncHandler } from '../shared/asyncHandler.js';
import { ExternalServiceError, NotFoundError, ValidationError } from '../shared/errors.js';
import logger from '../shared/logger.js';
import { InstagramChat } from './instagram.js';
import type { ChatThread } from './instagram.js';
import { parseChatCredentials } from './totp.js';

const router = Router();
router.get('/threads', asyncHandler(async (req, res) => {
  const profiles = (await profilesList()).filter(profile =>
    profile.igLoggedIn && profile.status !== 'deleting');
  const threads: (ChatThread & { profileId: string; profileName: string; viewerId: string })[] = [];
  const errors: { profileName: string; message: string }[] = [];
  for (let index = 0; index < profiles.length; index += 4) {
    await Promise.all(profiles.slice(index, index + 4).map(async profile => {
      try {
        const inbox = await cachedInbox(profile, req.query.refresh === '1');
        threads.push(...inbox.threads.map(thread => ({ ...thread, profileId: profile.id,
          profileName: profile.name, viewerId: inbox.viewerId })));
      } catch {
        errors.push({ profileName: profile.name, message: 'Could not load inbox' });
      }
    }));
  }
  res.json({ threads, errors });
}));

async function client(profileId: unknown): Promise<InstagramChat> {
  const profile = await selectedProfile(profileId);
  try { return await InstagramChat.load(profile); }
  catch (error) {
    if (error instanceof Error && error.message === 'Connect this profile to Instagram Chat first') {
      throw new ValidationError(error.message);
    }
    throw error;
  }
}

async function selectedProfile(profileId: unknown) {
  if (typeof profileId !== 'string' || !profileId.trim()) throw new ValidationError('Select a profile');
  const profile = await profilesGetById(profileId);
  if (!profile) throw new NotFoundError('Profile not found');
  return profile;
}

function threadId(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,40}$/.test(value)) throw new ValidationError('Invalid thread ID');
  return value;
}

function instagramError(error: unknown): never {
  const name = error instanceof Error ? error.name : '';
  if (name === 'IgLoginBadPasswordError' || name === 'IgLoginInvalidUserError') {
    throw new ValidationError('Instagram username or password is incorrect');
  }
  if (name === 'IgLoginTwoFactorRequiredError') {
    throw new ValidationError('Instagram requires two-factor verification');
  }
  if (error instanceof Error && error.message === 'Instagram CAA rejected the verification code') {
    throw new ValidationError('Instagram did not accept the authenticator code');
  }
  if (error instanceof Error && error.message === 'Instagram requested email verification; this test supports authenticator codes only') {
    throw new ValidationError(error.message);
  }
  if (error instanceof Error && error.message === 'Instagram Chat could not connect through the profile proxy') {
    throw new ExternalServiceError(error.message);
  }
  if (error instanceof Error && /^(Instagram mobile|Instagram CAA|Instagram rejected CAA|Instagram did not provide|Instagram returned an invalid CAA)/.test(error.message)) {
    throw new ExternalServiceError(error.message);
  }
  if (/Login|Challenge|Checkpoint|TwoFactor/i.test(name)) {
    throw new ExternalServiceError('Instagram requires a new Chat login or account verification');
  }
  if (error instanceof IgResponseError) {
    const status = error.response.statusCode;
    const kind = error.response.body?.error_type;
    const detail = typeof kind === 'string' && /^[a-z_]{1,40}$/i.test(kind) ? `: ${kind}` : '';
    throw new ExternalServiceError(`Instagram DM request HTTP ${status}${detail}`);
  }
  throw new ExternalServiceError('Instagram DM request failed');
}

router.get('/:profileId/session', asyncHandler(async (req, res) => {
  const profile = await selectedProfile(req.params.profileId);
  res.json({ connected: await InstagramChat.hasSession(profile.id) });
}));

router.post('/:profileId/session', asyncHandler(async (req, res) => {
  const profile = await selectedProfile(req.params.profileId);
  const credentials = parseChatCredentials(req.body?.credentials);
  if (!credentials) throw new ValidationError('Enter username:password:authenticator key');
  if (!profile.igLoggedIn || profile.status === 'deleting') {
    throw new ValidationError('Turn on Logged in for this profile');
  }
  try {
    await InstagramChat.login(profile, credentials.username, credentials.password, credentials.authenticatorKey);
    clearSyncFailures(profile.id);
    res.json({ connected: true });
  } catch (error) { instagramError(error); }
}));

router.delete('/:profileId/session', asyncHandler(async (req, res) => {
  const profile = await selectedProfile(req.params.profileId);
  await InstagramChat.logout(profile.id);
  clearSyncFailures(profile.id);
  res.json({ connected: false });
}));

router.get('/:profileId/threads', asyncHandler(async (req, res) => {
  const profile = await selectedProfile(req.params.profileId);
  const inbox = await cachedInbox(profile, req.query.refresh === '1').catch(instagramError);
  if (!inbox.connected) throw new ValidationError('Connect this profile to Instagram Chat first');
  res.json(inbox);
}));

router.get('/:profileId/threads/:threadId', asyncHandler(async (req, res) => {
  const id = threadId(req.params.threadId);
  const profile = await selectedProfile(req.params.profileId);
  try { res.json(await cachedThread(profile, id, req.query.refresh === '1')); } catch (error) { instagramError(error); }
}));

router.post('/:profileId/threads/:threadId/reply', asyncHandler(async (req, res) => {
  const id = threadId(req.params.threadId);
  const text = req.body?.text;
  if (typeof text !== 'string' || !text.trim() || text.length > 1000) {
    throw new ValidationError('Reply must contain 1 to 1000 characters');
  }
  const clientContext = req.body?.clientContext;
  if (clientContext !== undefined && (typeof clientContext !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientContext))) {
    throw new ValidationError('Invalid Chat message ID');
  }
  const chat = await client(req.params.profileId);
  const replyStartedAt = Date.now();
  let message: ChatThread['messages'][number];
  try { message = await chat.reply(id, text.trim(), clientContext); } catch (error) { instagramError(error); }
  res.json({ success: true, message });
  // Instagram accepted the DM. Cache work must not delay or fail the send response.
  void (async () => {
    try {
      await chatMarkReplied(String(req.params.profileId), chat.cacheToken, id, replyStartedAt);
    } catch (err) {
      logger.warn({ err, profileId: req.params.profileId, threadId: id }, 'Could not mark sent DM in Chat cache');
    }
    try {
      // An existing read may have started before the send. Wait, then fetch the reply.
      await threadSyncs.get(`${req.params.profileId}:${id}`)?.catch(() => {});
      await syncThread(await selectedProfile(req.params.profileId), id);
    } catch (err) {
      logger.warn({ err, profileId: req.params.profileId, threadId: id }, 'Could not refresh Chat after sent DM');
    }
  })();
}));

export default router;
