import { randomUUID } from 'node:crypto'
import type { Page } from 'playwright-core'
import { warmupBeginRun, warmupFinishRun, type DbWarmupState } from '../shared/convexClient.js'
import { browseFeed } from './actions/feed.js'
import { watchStories } from './actions/stories.js'
import type { ActionLogger, StopCheck } from './actions/shared.js'

const defaults = {
  warmup_min_minutes: 30, warmup_max_minutes: 60,
  session_min_minutes: 5, session_max_minutes: 10,
  rest_min_minutes: 60, rest_max_minutes: 120,
  stories_max: 3, stories_min_view_seconds: 2, stories_max_view_seconds: 5,
  like_chance: 10, follow_chance: 0, carousel_watch_chance: 0, carousel_max_slides: 3,
  skip_post_chance: 30, skip_post_max: 2, post_view_min_seconds: 2, post_view_max_seconds: 5,
  profile_visit_chance: 35, liked_profile_visit_chance: 80, own_profile_chance: 10,
  dm_chance: 8, reels_chance: 12, reels_min: 3, reels_max: 8, reels_skip_chance: 25,
}
export type WarmupConfig = typeof defaults & { watch_stories: boolean }

export function warmupConfig(input: Record<string, unknown>): WarmupConfig {
  const config = { ...defaults, watch_stories: input.watch_stories === true }
  for (const key of Object.keys(defaults) as Array<keyof typeof defaults>) {
    const value = input[key]
    if (typeof value === 'number' && Number.isFinite(value)) config[key] = Math.max(0, value)
  }
  config.warmup_min_minutes = Math.max(1, config.warmup_min_minutes)
  config.warmup_max_minutes = Math.max(config.warmup_min_minutes, config.warmup_max_minutes)
  config.session_min_minutes = Math.max(1, config.session_min_minutes)
  config.session_max_minutes = Math.max(config.session_min_minutes, config.session_max_minutes)
  config.rest_max_minutes = Math.max(config.rest_min_minutes, config.rest_max_minutes)
  return config
}

/** Check before opening a browser; Convex checks again when reserving time. */
export function warmupReady(state: Pick<DbWarmupState, 'date' | 'nextRunAt' | 'reservedMinutes' | 'minutesUsedToday' | 'todayMinutes'> | null, now = Date.now()): boolean {
  if (!state) return true
  if ((state.nextRunAt ?? 0) > now) return false
  if (state.date !== new Date(now).toISOString().slice(0, 10)) return true
  return !state.reservedMinutes && state.minutesUsedToday < state.todayMinutes
}

const dependencies = { begin: warmupBeginRun, finish: warmupFinishRun, feed: browseFeed, stories: watchStories, now: Date.now }
export type WarmupResult = { minutes: number; reason: 'finished' | 'stopped' | 'stalled' | 'skipped' }
export type SessionActivity = (session: {
  deadline: number; remainingMinutes: number;
  browse: (minutes: number) => Promise<WarmupResult['reason']>;
}) => Promise<WarmupResult['reason']>;

/** Reserve once, run within the deadline, and account for elapsed time even on failure. */
export async function runWarmup(
  profileId: string, automationId: string, input: Record<string, unknown>, page: Page,
  log: ActionLogger, shouldStop: StopCheck, deps = dependencies,
  activity?: SessionActivity,
): Promise<WarmupResult> {
  const config = warmupConfig(input)
  const runId = randomUUID()
  const plan = await deps.begin({ profileId, automationId, runId,
    minMinutes: config.warmup_min_minutes, maxMinutes: config.warmup_max_minutes,
    sessionMinMinutes: config.session_min_minutes, sessionMaxMinutes: config.session_max_minutes,
    restMinMinutes: config.rest_min_minutes, restMaxMinutes: config.rest_max_minutes })
  if (plan.minutes <= 0) {
    log('Warm-up skipped: resting, or daily budget is used or reserved')
    return { minutes: 0, reason: 'skipped' }
  }
  const startedAt = deps.now()
  const deadline = Math.min(startedAt + plan.minutes * 60_000, Date.parse(`${plan.date}T00:00:00Z`) + 86_400_000)
  const stopped = () => shouldStop() || deps.now() >= deadline
  let reason: WarmupResult['reason'] = 'stopped'
  let elapsed = 0
  try {
    if (activity) {
      let storiesWatched = false
      reason = await activity({ deadline, remainingMinutes: Math.min(plan.remainingMinutes ?? plan.minutes,
        Math.max(0, Date.parse(`${plan.date}T00:00:00Z`) + 86_400_000 - startedAt) / 60_000),
        browse: async minutes => {
          const browseDeadline = Math.min(deadline, deps.now() + minutes * 60_000)
          const browseStopped = () => stopped() || deps.now() >= browseDeadline
          if (config.watch_stories && !storiesWatched && !browseStopped()) {
            storiesWatched = true
            await deps.stories(page, config.stories_max, log, browseStopped, {
              minSeconds: config.stories_min_view_seconds, maxSeconds: config.stories_max_view_seconds,
              deadline: browseDeadline,
            })
          }
          return browseStopped() ? 'finished' : deps.feed(page,
            Math.max(0, browseDeadline - deps.now()) / 60_000, config, log, browseStopped)
        },
      })
    } else {
      if (config.watch_stories && !stopped())
        await deps.stories(page, config.stories_max, log, stopped, {
          minSeconds: config.stories_min_view_seconds, maxSeconds: config.stories_max_view_seconds,
          deadline,
        })
      if (!stopped()) {
        reason = await deps.feed(page, Math.max(0, deadline - deps.now()) / 60_000, config, log, stopped)
      }
    }
    if (!shouldStop() && deps.now() >= deadline) reason = 'finished'
  } finally {
    elapsed = Math.min(plan.minutes, Math.max(0, deps.now() - startedAt) / 60_000)
    await deps.finish({ profileId, runId, date: plan.date, minutes: elapsed })
  }
  log(`Warm-up ended: ${reason} (${elapsed.toFixed(1)} minutes)`)
  return { minutes: elapsed, reason }
}
