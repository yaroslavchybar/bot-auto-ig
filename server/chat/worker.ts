import { profilesList } from '../shared/convexClient.js';
import logger from '../shared/logger.js';
import { cachedInbox } from './sync.js';

export const CHAT_SYNC_INTERVAL_MS = 15 * 60_000;

// Share cache freshness, in-flight requests, and failure backoff with the Chat page.
export function startChatWorker(): () => void {
  let stopped = false;
  let busy = false;
  const tick = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const profiles = (await profilesList()).filter(profile =>
        profile.igLoggedIn && profile.status !== 'deleting');
      for (let index = 0; index < profiles.length && !stopped; index += 4) {
        await Promise.all(profiles.slice(index, index + 4).map(async profile => {
          try { await cachedInbox(profile); }
          catch { logger.warn({ profileId: profile.id }, 'Background Chat inbox sync failed'); }
        }));
      }
    } catch {
      logger.warn('Background Chat sync could not load profiles');
    } finally { busy = false; }
  };
  const timer = setInterval(() => { void tick(); }, CHAT_SYNC_INTERVAL_MS);
  timer.unref();
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}
