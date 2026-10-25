import type { Page } from 'playwright-core'
import type { WarmupFollowRequest } from '../../shared/convexClient.js'
import type { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { warmupTopics } from '../../shared/warmupTopics.js'
import type { SessionActivity, SessionResult } from '../sessions.js'
import { browseUntilEnd } from '../routine-schedule.js'
import { browseHomeFeed } from './home-feed.js'
import { openReels, waitForReelOutreach, watchReels } from './reels.js'
import { watchStories } from './stories.js'
import { assertInstagramReady, checkNotifications, hasUnreadNotifications } from './instagram-state.js'
import { openDMs } from './inbox.js'
import { visitOutreachPausePage } from './outreach-pause.js'
import { backToFeed } from './navigation.js'
import { followTopicAccounts } from './topic-follow.js'
import { topicSearchTerms } from './topic-search.js'
import { BrowseSession, SessionEnded } from './session.js'
import { isTemporaryUiError } from './ui-errors.js'
import { random, sleep, type ActionLogger, type StopCheck } from './shared.js'
import { addLogContext } from '../../shared/logger.js'
import { withUiDiagnosticContext } from './ui-diagnostics.js'

export type FeedSessionContext = {
  deadline: number; remainingMinutes: number; day: number; config: Record<string, unknown>;
  budget: WarmupActivityBudget; unseenStories: boolean; request: Omit<WarmupFollowRequest, 'username'>;
}
export type FeedState = { next: 'home' | 'reels'; homeSeen: Set<string>; reelsSeen: Set<string> }
const contentDependencies = { home: browseHomeFeed, openReels, reels: watchReels, now: Date.now, random }

/** Home and Reels are sibling actions; neither surface owns navigation to the other. */
export async function browseContent(page: Page, end: number, config: Record<string, unknown>, budget: WarmupActivityBudget,
  state: FeedState, log: ActionLogger, stopped: StopCheck, deps = contentDependencies): Promise<SessionResult['reason']> {
  const home = config.browse_home_feed !== false, reels = config.scroll_reels !== false
  if (!home && !reels) return 'skipped'
  let empty = 0
  const initial = budget.browsed
  while (!stopped() && deps.now() < end) {
    const surface = home && reels ? state.next : home ? 'home' : 'reels'
    state.next = surface === 'home' ? 'reels' : 'home'
    const sliceEnd = home && reels ? Math.min(end, deps.now() + deps.random(60_000, 120_000)) : end
    const session = new BrowseSession(sliceEnd, stopped)
    const before = budget.browsed
    const slice: Record<string, unknown> = { surface, startedAt: deps.now() }
    addLogContext({ lastBrowsingSlice: slice })
    try {
      const result = await withUiDiagnosticContext({ session, stage: `browse_${surface}` }, async () => {
        if (surface === 'home') {
          const result = await deps.home(page, session, config, log, budget, undefined, state.homeSeen)
          if (result === 'stopped' && stopped()) return 'stopped'
        } else if (await deps.openReels(page, log, session)) {
          await deps.reels(page, session, config, log, budget, undefined, state.reelsSeen)
        }
      })
      if (result === 'stopped') return 'stopped'
    } catch (error) {
      if (!(error instanceof SessionEnded)) {
        if (!isTemporaryUiError(error)) throw error
        await assertInstagramReady(page, new BrowseSession(end, stopped))
        log({ event: 'automation.browse.surface_unavailable', surface, error, outcome: 'skipped' })
      }
      if (stopped()) return 'stopped'
    } finally {
      Object.assign(slice, { durationMs: Math.max(0, deps.now() - Number(slice.startedAt)),
        browsed: budget.browsed - before, deadlineReached: deps.now() >= sliceEnd })
    }
    empty = budget.browsed === before ? empty + 1 : 0
    if (empty >= (home && reels ? 2 : 1)) break
  }
  return stopped() ? 'stopped' : budget.browsed > initial ? 'finished' : 'stalled'
}

const dependencies = { content: browseContent, stories: watchStories, check: assertInstagramReady,
  unreadNotifications: hasUnreadNotifications, notifications: checkNotifications, inbox: openDMs,
  home: backToFeed, openReels, follow: followTopicAccounts,
  terms: topicSearchTerms, waitForOutreach: waitForReelOutreach, visitDuringPause: visitOutreachPausePage, now: Date.now, random, sleep }

/** One browsing flow owns startup checks, Stories, content, follows/DMs, and scheduled cleanup. */
export async function runBrowseFeedSession(page: Page, context: FeedSessionContext, log: ActionLogger, shouldStop: StopCheck,
  activity?: SessionActivity, startupNotifications?: (session: BrowseSession, day: number, unread?: boolean) => Promise<void>, deps = dependencies
): Promise<SessionResult['reason']> {
  const started = deps.now()
  const { deadline, config, budget, day } = context
  const stopped = () => shouldStop() || deps.now() >= deadline
  const session = new BrowseSession(deadline, stopped)
  const state: FeedState = { next: config.browse_home_feed === false ? 'reels' : 'home', homeSeen: new Set(), reelsSeen: new Set() }
  const browse = async (minutes: number): Promise<SessionResult['reason']> => {
    const end = Math.min(deadline, deps.now() + minutes * 60_000)
    if (deps.now() >= end || stopped()) return stopped() ? 'stopped' : 'stalled'
    const before = budget.browsed
    const result = await deps.content(page, end, config, budget, state, log, shouldStop)
    if (result === 'finished' && budget.browsed === before) return 'stalled'
    return result
  }
  await deps.check(page, session)
  let unreadNotifications = false
  try {
    unreadNotifications = await deps.unreadNotifications(page)
  } catch (error) {
    session.check()
    if (!isTemporaryUiError(error)) throw error
    if (startupNotifications) unreadNotifications = true
    else await deps.notifications(page, log, session)
  }
  // Daily conversion tracking must also see follow-backs from an already-read notification panel.
  if (startupNotifications) await startupNotifications(session, day, unreadNotifications)
  else if (unreadNotifications) await deps.notifications(page, log, session)
  if (stopped()) return 'stopped'
  await deps.inbox(page, log, session)
  if (stopped()) return 'stopped'
  const home = config.browse_home_feed !== false
  const topics = warmupTopics(config.warmup_topics)
  const stories = config.watch_stories !== false && context.unseenStories
  if (home || stories) await deps.home(page, log, session)
  if (stopped()) return 'stopped'
  if (stories) {
    budget.used.stories += await deps.stories(page, session, log, {
      watchUntil: Math.min(deadline, deps.now() + deps.random(60_000, 180_000)), budget })
    if (!stopped()) await deps.check(page, session)
  }
  if (stopped()) return 'stopped'
  if (!home && config.scroll_reels !== false) await deps.openReels(page, log, session)
  if (stopped()) return 'stopped'
  if (day >= 3 && day <= 7 && topics.length && budget.remaining('follows') &&
    (config.browse_home_feed !== false || config.scroll_reels !== false)) {
    const followSession = new BrowseSession(Math.min(deadline, deps.now() + (deadline - deps.now()) * 0.2), stopped)
    try {
      const terms = await deps.terms(topics, followSession, log)
      await deps.follow(page, topics, budget, followSession, context.request, log, undefined,
        async () => {
          const before = budget.browsed
          await deps.content(page, Math.min(followSession.end, deps.now() + deps.random(15_000, 30_000)), config,
            budget, state, log, () => followSession.stopped())
          return budget.browsed > before
        }, terms)
    } catch (error) { if (!(error instanceof SessionEnded) || stopped()) throw error }
  }
  if (stopped()) return 'stopped'
  const available = { deadline, day,
    remainingMinutes: Math.max(0, context.remainingMinutes - (deps.now() - started) / 60_000), browse,
    waitForOutreach: (until: number) => deps.waitForOutreach(page, until, config, session, log),
    visitDuringPause: (destination: 'profile' | 'dms', until: number) =>
      deps.visitDuringPause(page, destination, until, session, log) }
  // The routine callback schedules follow/DM batches and unfollows through this same browse function.
  return activity ? activity(available) : browseUntilEnd(available, {
    now: deps.now, stopped: shouldStop, random: deps.random, sleep: deps.sleep, log,
  })
}
