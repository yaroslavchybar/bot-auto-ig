import { profilesGetById } from '../shared/convexClient.js';
import { watchChatProfiles } from '../shared/convexRealtime.js';
import logger from '../shared/logger.js';
import { cachedInbox } from './sync.js';

export const CHAT_SYNC_INTERVAL_MS = 15 * 60_000;

// Share cache freshness, in-flight requests, and failure backoff with the Chat page.
export function startChatWorker(): () => void {
  let stopped = false;
  let busy = false;
  let profileIds: string[] = [];
  const tick = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const ids = [...profileIds];
      for (let index = 0; index < ids.length && !stopped; index += 4) {
        await Promise.all(ids.slice(index, index + 4).map(async profileId => {
          try {
            const profile = await profilesGetById(profileId);
            if (profile?.igLoggedIn && profile.status !== 'deleting') await cachedInbox(profile);
          }
          catch { logger.warn({ profileId }, 'Background Chat inbox sync failed'); }
        }));
      }
    } catch {
      logger.warn('Background Chat sync could not load profiles');
    } finally { busy = false; }
  };
  const timer = setInterval(() => { void tick(); }, CHAT_SYNC_INTERVAL_MS);
  timer.unref();
  const subscription = watchChatProfiles(ids => { profileIds = ids; void tick(); },
    err => { profileIds = []; logger.warn({ err }, 'Chat profile subscription failed'); });
  void subscription.initial.catch(() => undefined);
  return () => { stopped = true; clearInterval(timer); subscription.unsubscribe(); };
}
