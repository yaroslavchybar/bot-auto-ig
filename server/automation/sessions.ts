import { browsingDefaults as defaults, browsingFlags } from '../shared/browsingSettings.js'
import { randomUUID } from 'node:crypto'
import type { Page } from 'playwright-core'
import { warmupBeginRun, warmupFinishRun, warmupPrepareDay } from '../shared/convexClient.js'
import { WarmupActivityBudget, warmupActivityPlan } from '../shared/warmupPlan.js'
import { warmupTopics } from '../shared/warmupTopics.js'
import { BrowseSession, SessionEnded } from './actions/session.js'
import { runExploreWarmup } from './actions/explore-warmup.js'
import { runBrowseFeedSession } from './actions/browse-feed.js'
import { assertInstagramReady } from './actions/instagram-state.js'
import { hasUnseenStories } from './actions/stories.js'
import { isInstagramHome } from './actions/navigation.js'
import type { ActionLogger, StopCheck } from './actions/shared.js'
import { setSessionAppearance } from './actions/appearance.js'
import { addLogContext } from '../shared/logger.js'

export type SessionConfig = typeof defaults & {
  watch_stories: boolean; warmup_topics: string[]; browse_home_feed: boolean; scroll_reels: boolean; warmup_day?: number
}

/** Only session time and enabled surfaces are configurable; engagement follows interest evidence. */
export function sessionConfig(input: Record<string, unknown>): SessionConfig {
  const config = { ...defaults, warmup_topics: warmupTopics(input.warmup_topics),
    browse_home_feed: typeof input.browse_home_feed === 'boolean' ? input.browse_home_feed : browsingFlags.browse_home_feed, scroll_reels: typeof input.scroll_reels === 'boolean' ? input.scroll_reels : browsingFlags.scroll_reels,
    watch_stories: typeof input.watch_stories === 'boolean' ? input.watch_stories : browsingFlags.watch_stories }
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

export function prepareBrowsingDay(profileId: string, input: Record<string, unknown>): Promise<boolean> {
  const config = sessionConfig(input)
  return warmupPrepareDay({ profileId, minMinutes: config.warmup_min_minutes, maxMinutes: config.warmup_max_minutes })
}


export type SessionResult = { minutes: number; reason: 'finished' | 'stopped' | 'stalled' | 'skipped' }
export type SessionActivity = (session: {
  deadline: number; remainingMinutes: number; day?: number;
  browse: (minutes: number) => Promise<SessionResult['reason']>;
  waitForOutreach?: (until: number) => Promise<boolean>;
  visitDuringPause?: (destination: 'profile' | 'dms', until: number) => Promise<void>;
}) => Promise<SessionResult['reason']>

const dependencies = { begin: warmupBeginRun, finish: warmupFinishRun, explore: runExploreWarmup,
  browse: runBrowseFeedSession, check: assertInstagramReady, appearance: setSessionAppearance,
  unseenStories: hasUnseenStories, now: Date.now }

/** One reservation owns both phases: optional Explore warm-up, then the shared browsing flow. */
export async function runBrowsingSession(profileId: string, automationId: string, input: Record<string, unknown>, page: Page,
  log: ActionLogger, shouldStop: StopCheck, deps = dependencies, activity?: SessionActivity,
  startupNotifications?: (session: BrowseSession, day: number, unread?: boolean) => Promise<void>): Promise<SessionResult> {
  const config = sessionConfig(input), runId = randomUUID()
  addLogContext({ profileId, automationId, runId })
  const plan = await deps.begin({ profileId, automationId, runId,
    minMinutes: config.warmup_min_minutes, maxMinutes: config.warmup_max_minutes,
    sessionMinMinutes: config.session_min_minutes, sessionMaxMinutes: config.session_max_minutes,
    restMinMinutes: config.rest_min_minutes, restMaxMinutes: config.rest_max_minutes })
  if (plan.minutes <= 0) {
    addLogContext({ browsingResult: 'skipped', browsingSkipReason: 'resting_or_budget_used' })
    log({ event: 'automation.session.skipped', reason: 'resting_or_budget_used' })
    return { minutes: 0, reason: 'skipped' }
  }
  const started = deps.now(), midnight = Date.parse(plan.date + 'T00:00:00Z') + 86_400_000
  const deadline = Math.min(started + plan.minutes * 60_000, midnight)
  const stopped = () => shouldStop() || deps.now() >= deadline
  const day = plan.day ?? 1
  addLogContext({ warmupDay: day, reservedMinutes: plan.minutes })
  config.warmup_day = day
  const daily = plan.activityPlan ?? warmupActivityPlan(day)
  const eligible = day >= 2 && config.warmup_topics.length > 0
  const budget = new WarmupActivityBudget(eligible ? daily : { ...daily, likes: 0, follows: 0, saves: 0, comments: 0 }, plan.activityUsed)
  let reason: SessionResult['reason'] = 'stopped', minutes = 0
  try {
    if (!stopped()) {
      const session = new BrowseSession(deadline, stopped)
      await deps.check(page, session)
      await deps.appearance(page, plan.timezone, session, log)
      if (config.watch_stories && !isInstagramHome(page)) {
        await page.goto('https://www.instagram.com/', {
          waitUntil: 'domcontentloaded', timeout: session.timeout(15_000),
        })
        await deps.check(page, session)
      }
      const unseenStories = config.watch_stories && await deps.unseenStories(page, session)
      log({ event: 'automation.session.daily_plan', day, activityPlan: budget.plan, activityUsed: budget.used })
      // Explore receives part of this reservation, leaving time for the common browsing flow.
      await deps.explore(page, Math.min(deadline, deps.now() + (deadline - deps.now()) * 0.3), config, budget, log, stopped)
      if (!stopped()) reason = await deps.browse(page, {
        deadline, day, config, budget, unseenStories, request: { profileId, runId, date: plan.date },
        remainingMinutes: Math.max(0, Math.min(plan.remainingMinutes ?? plan.minutes, (midnight - started) / 60_000) - (deps.now() - started) / 60_000),
      }, log, shouldStop, activity, startupNotifications)
    }
    if (!shouldStop() && deps.now() >= deadline && reason !== 'stalled') reason = 'finished'
  } catch (error) {
    if (!(error instanceof SessionEnded)) throw error
    reason = shouldStop() ? 'stopped' : 'finished'
  } finally {
    minutes = Math.min(plan.minutes, Math.max(0, deps.now() - started) / 60_000)
    addLogContext({ browsingMinutes: minutes, activityAttempts: budget.delta() })
    await deps.finish({ profileId, runId, date: plan.date, minutes, activity: budget.delta() })
  }
  if (reason === 'stalled') addLogContext({ outcome: 'error', sessionReason: reason })
  addLogContext({ browsingResult: reason })
  log({ event: 'automation.session.finished', reason, minutes, activityAttempts: budget.delta() })
  return { minutes, reason }
}
