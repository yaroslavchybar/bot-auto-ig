import { randomUUID } from 'node:crypto'
import type { Page } from 'playwright-core'
import { warmupBeginRun, warmupFinishRun, type DbWarmupState } from '../shared/convexClient.js'
import { browseFeed } from './actions/feed.js'
import { watchStories } from './actions/stories.js'
import { random, sleep, type ActionLogger, type StopCheck } from './actions/shared.js'
import { assertInstagramReady, checkNotifications } from './actions/instagram-state.js'
import { openDMs } from './actions/inbox.js'
import { backToFeed } from './actions/navigation.js'
import { BrowseSession, SessionEnded } from './actions/session.js'
import { WarmupActivityBudget, warmupActivityPlan } from '../shared/warmupPlan.js'
import { warmupTopics } from '../shared/warmupTopics.js'
import { browseTopics, type TopicBrowseState } from './actions/topic-browsing.js'
import { engageWeekOne } from './actions/week-one.js'
import { browseUntilEnd } from './routine-schedule.js'
import { topicSearchTerms } from './actions/topic-search.js'

const defaults = {
  warmup_min_minutes: 10, warmup_max_minutes: 20,
  session_min_minutes: 5, session_max_minutes: 10,
  rest_min_minutes: 60, rest_max_minutes: 120,
  stories_max: 3, stories_min_view_seconds: 2, stories_max_view_seconds: 5,
  carousel_watch_chance: 0, carousel_max_slides: 3,
  skip_post_chance: 30, skip_post_max: 2, post_view_min_seconds: 2, post_view_max_seconds: 5,
  profile_visit_chance: 35, own_profile_chance: 10,
  dm_chance: 8, reels_chance: 35, reels_min: 3, reels_max: 8, reels_skip_chance: 25,
}
export type WarmupConfig = typeof defaults & {
  watch_stories: boolean; warmup_topics: string; browse_home_feed: boolean; scroll_reels: boolean; warmup_day?: number
}

export function warmupConfig(input: Record<string, unknown>): WarmupConfig {
  const config = { ...defaults,
    warmup_topics: warmupTopics(input.warmup_topics)[0] ?? '',
    browse_home_feed: input.browse_home_feed !== false,
    scroll_reels: input.scroll_reels !== false,
    watch_stories: input.watch_stories !== false }
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

const dependencies = { begin: warmupBeginRun, finish: warmupFinishRun, feed: browseFeed, stories: watchStories,
  check: assertInstagramReady, notifications: checkNotifications, inbox: openDMs, home: backToFeed, topics: browseTopics, engage: engageWeekOne, searchTerms: topicSearchTerms, now: Date.now, sleep }
export type WarmupResult = { minutes: number; reason: 'finished' | 'stopped' | 'stalled' | 'skipped' }
export type SessionActivity = (session: {
  deadline: number; remainingMinutes: number;
  day?: number; takeLike?: () => boolean;
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
    log({ event: 'automation.warmup.warm_up_skipped_resting_or', message: 'Warm-up skipped: resting, or daily budget is used or reserved' })
    return { minutes: 0, reason: 'skipped' }
  }
  const startedAt = deps.now()
  const closingDeadline = Math.min(startedAt + plan.minutes * 60_000, Date.parse(`${plan.date}T00:00:00Z`) + 86_400_000)
  const deadline = Math.max(startedAt, closingDeadline - Math.min(12_000, plan.minutes * 6000))
  const stopped = () => shouldStop() || deps.now() >= deadline
  const day = plan.day ?? 1
  config.warmup_day = day
  const dailyPlan = plan.activityPlan ?? warmupActivityPlan(day)
  const engage = day >= 2 && day <= 7 && warmupTopics(config.warmup_topics).length > 0
  const budget = new WarmupActivityBudget(day > 7 || engage ? dailyPlan : { ...dailyPlan, likes: 0, follows: 0 }, plan.activityUsed)
  const topicState: TopicBrowseState = { feedViewed: false, profilesChecked: false, seenPosts: new Set() }
  const session = new BrowseSession(deadline, stopped)
  const stories = async (end: number, stop: StopCheck) => {
    const count = Math.min(Math.floor(config.stories_max), budget.remaining('stories'))
    if (!config.watch_stories || !count || stop()) return
    const watched = await deps.stories(page, count, log, stop, { minSeconds: config.stories_min_view_seconds,
      maxSeconds: config.stories_max_view_seconds, deadline: end })
    for (let i = 0; i < watched; i++) budget.take('stories')
  }
  const browse = (end: number, stop: StopCheck) => !config.browse_home_feed && (!config.scroll_reels || !budget.remaining('reels'))
    ? Promise.resolve('skipped' as const)
    : warmupTopics(config.warmup_topics).length || !config.browse_home_feed
    ? deps.topics(page, end, config, budget, topicState, log, stop)
    : deps.feed(page, Math.max(0, end - deps.now()) / 60_000, config, log, stop, budget)
  let storiesWatched = false
  const browseChunk: Parameters<SessionActivity>[0]['browse'] = async minutes => {
    const browseDeadline = Math.min(deadline, deps.now() + minutes * 60_000)
    const browseStopped = () => stopped() || deps.now() >= browseDeadline
    if (config.watch_stories && !storiesWatched && !browseStopped()) {
      storiesWatched = true
      await stories(browseDeadline, browseStopped)
    }
    if (browseStopped()) return stopped() ? 'stopped' : 'stalled'
    const before = budget.browsed
    let result = await browse(browseDeadline, browseStopped)
    // A chunk deadline is not a stop request for the entire profile session.
    if (result === 'stopped' && !stopped() && deps.now() >= browseDeadline) result = 'finished'
    return result === 'finished' && budget.browsed === before ? 'stalled' : result
  }
  let reason: WarmupResult['reason'] = 'stopped'
  let elapsed = 0
  try {
    if (!stopped()) {
      await deps.check(page)
      log({ event: 'automation.warmup.daily_plan', day: plan.day ?? 1, activityPlan: budget.plan, activityUsed: budget.used })
      await deps.notifications(page, log, session)
      if (!stopped()) await deps.inbox(page, log, session)
      if (!stopped()) await deps.home(page, log, session)
      if (!stopped()) await deps.check(page)
      if (!stopped() && config.warmup_topics && (engage || config.browse_home_feed || config.scroll_reels))
        topicState.searchTerms = await deps.searchTerms(config.warmup_topics, session, log)
      if (!stopped() && engage && (budget.remaining('likes') || budget.remaining('follows'))) {
        const engagementSession = new BrowseSession(Math.min(deadline, deps.now() + plan.minutes * 60_000 * 0.4), stopped)
        try {
          await deps.engage(page, config.warmup_topics, budget, engagementSession, { profileId, runId, date: plan.date }, log,
            undefined, async () => {
              const before = budget.browsed
              const result = await browse(Math.min(engagementSession.end, deps.now() + random(15_000, 30_000)), () => engagementSession.stopped())
              return result === 'finished' && budget.browsed > before
            }, topicState.searchTerms)
        } catch (error) {
          if (!(error instanceof SessionEnded) || stopped()) throw error
        }
        if (!stopped()) await deps.home(page, log, session)
      }
    }
    if (!stopped() && activity) {
      reason = await activity({ deadline, day, takeLike: () => budget.take('likes'), remainingMinutes: Math.max(0, Math.min(plan.remainingMinutes ?? plan.minutes,
        Math.max(0, Date.parse(`${plan.date}T00:00:00Z`) + 86_400_000 - startedAt) / 60_000) - (deps.now() - startedAt) / 60_000),
        browse: browseChunk,
      })
    } else if (!stopped()) {
      reason = await browseUntilEnd({ deadline, browse: browseChunk }, {
        now: deps.now, stopped: shouldStop, random, sleep: deps.sleep, log,
      })
    }
    if (!shouldStop() && deps.now() >= deadline) reason = 'finished'
    if (!shouldStop() && deps.now() < closingDeadline) {
      await deps.check(page)
      await deps.notifications(page, log, new BrowseSession(closingDeadline, shouldStop))
    }
  } catch (error) {
    if (!(error instanceof SessionEnded)) throw error
    reason = shouldStop() ? 'stopped' : 'finished'
  } finally {
    elapsed = Math.min(plan.minutes, Math.max(0, deps.now() - startedAt) / 60_000)
    await deps.finish({ profileId, runId, date: plan.date, minutes: elapsed, activity: budget.delta() })
  }
  log({ event: 'automation.warmup.warm_up_ended', activityAttempts: budget.delta(), message: `Warm-up ended: ${reason} (${elapsed.toFixed(1)} minutes)` })
  return { minutes: elapsed, reason }
}
