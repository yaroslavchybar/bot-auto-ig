import { profilesGetById } from '../shared/convexClient.js';
import { watchChatProfiles } from '../shared/convexRealtime.js';
import logger, { logOperation, addLogContext } from '../shared/logger.js';
import { cachedInbox, clearSyncFailures } from './sync.js'
import { InstagramChat } from './instagram.js'
import { getChatCache } from './cache.js'
import { broadcast } from '../websocket.js'

export const CHAT_SYNC_INTERVAL_MS = 15 * 60_000;

// Share cache freshness, in-flight requests, and failure backoff with the Chat page.
export function startChatWorker(): () => void {
  let stopped = false
  let busy = false
  let profileIds: string[] = []
  const tick = async () => {
    if (stopped || busy) return
    busy = true
    try {
      const ids = [...profileIds]
      for (let index = 0; index < ids.length && !stopped; index += 4) {
        await Promise.all(
          ids.slice(index, index + 4).map(async (profileId) => {
            await logOperation('chat.inbox_sync', { profileId }, async () => {
              try {
                const profile = await profilesGetById(profileId)
                if (profile?.igLoggedIn && profile.status !== 'deleting') {
                  const inbox = await cachedInbox(profile, true)
                  addLogContext({ profileName: profile.name, threadCount: inbox.threads.length })
                } else addLogContext({ outcome: 'skipped' })
              } catch (error) {
                addLogContext({ error, outcome: 'error' })
              }
            })
          }),
        )
      }
    } catch {
      logger.error({
        event: 'chat.worker.background_chat_sync_load_profiles',
        message: 'Background Chat sync could not load profiles',
        outcome: 'error',
      })
    } finally {
      busy = false
    }
  }
  const timer = setInterval(() => {
    void tick()
  }, CHAT_SYNC_INTERVAL_MS)
  timer.unref()
  const subscription = watchChatProfiles(
    (ids) => {
      for (const removed of profileIds.filter((id) => !ids.includes(id))) {
        InstagramChat.forgetSession(removed)
        clearSyncFailures(removed)
        broadcast({ type: 'chat_changed', profileId: removed })
      }
      getChatCache().retainProfiles(ids)
      profileIds = ids
      void tick()
    },
    (err) => {
      profileIds = []
      logger.error({
        event: 'chat.worker.chat_profile_subscription_failed',
        error: err,
        message: 'Chat profile subscription failed',
        outcome: 'error',
      })
    },
  )
  void subscription.initial.catch(() => undefined)
  return () => {
    stopped = true
    clearInterval(timer)
    subscription.unsubscribe()
  }
}
