import type { Locator, Page } from 'playwright-core'
import { BrowseSession, SessionEnded } from './session.js'
import { postChoices, detourDelay, viewContent } from './viewing.js'
import { focusPageContent } from '../../browser/focus.js'
import {
  chance,
  numeric,
  random,
  type ActionLogger,
  type StopCheck,
} from './shared.js'
import { clickPointOnScreen } from './guards.js'
import {
  clickVisible,
  driftMouse,
} from './mouse.js'
import {
  alignPostOnScreen,
  smoothScroll,
} from './scroll.js'
import { backToFeed, dismissPopups } from './navigation.js'
import {
  openAuthorProfile,
  openOwnProfile,
  openVisitorProfile,
  wanderProfile,
} from './profiles.js'
import { openDMs } from './inbox.js'
import { openReels, watchReels } from './reels.js'
import type { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { assertInstagramReady } from './instagram-state.js'
import { feedPostContext, feedPostMatches, warmupTopics } from '../../shared/warmupTopics.js'
import { topicContentMatches, type TopicMatcher } from './topic-intent.js'
import { maintainPost } from './maintenance.js'

// Ads get scrolled past, never engaged with. Header labels are checked separately.
// Structural markers: ad redirect links and tracking
// query params on profile links (normal post links are always clean).
async function isAdPost(target: Locator): Promise<boolean> {
  try {
    if (
      (await target.locator('a[href*="facebook.com/ads"], a[href*="ig_redirect"]').count()) > 0
    )
      return true
    const links = target.locator('a[href^="/"]')
    const m = Math.min(await links.count().catch(() => 0), 6)
    for (let i = 0; i < m; i++) {
      const href = await links.nth(i).getAttribute('href').catch(() => null)
      if (href && /^\/[^/?#]+\/\?/.test(href)) return true
    }
    return false
  } catch {
    return false
  }
}

/** Advance just past this post, leaving the next author available for inspection. */
async function advanceFeedPost(page: Page, target: Locator, session: BrowseSession, budget?: WarmupActivityBudget): Promise<void> {
  const box = await target.boundingBox().catch(() => null)
  const height = page.viewportSize()?.height ?? 800
  await smoothScroll(page, box ? Math.max(50, box.y + box.height - height * 0.25) : 450, session)
  if (budget) budget.browsed++
  await session.wait(random(300, 700))
}

async function hasVideo(target: Locator): Promise<boolean> {
  try {
    return (await target.locator('video').count()) > 0
  } catch {
    return false
  }
}

// Actual clip length in seconds, 0 if unknown. Read-only metadata.
async function videoDuration(target: Locator): Promise<number> {
  try {
    const d = await target
      .locator('video')
      .first()
      .evaluate((v) => (v as HTMLVideoElement).duration)
      .catch(() => NaN)
    return Number.isFinite(d) && (d as number) > 0 ? (d as number) : 0
  } catch {
    return 0
  }
}

// "You're all caught up" marker means no more feed to load.
async function isFeedEnd(page: Page): Promise<boolean> {
  try {
    const box = await page
      .getByText(/you're all caught up|you are all caught up/i)
      .first()
      .boundingBox()
    const height = page.viewportSize()?.height ?? 800
    return !!box && box.y < height && box.y + box.height > 0
  } catch {
    return false
  }
}

// Pick the id of a post from its permalink (/p/ or /reel/ link).
async function postId(target: Locator): Promise<string> {
  const href = await target
    .locator('a[href^="/p/"], a[href^="/reel/"]')
    .first()
    .getAttribute('href')
    .catch(() => null)
  return href?.match(/\/([A-Za-z0-9_-]+)\/?$/)?.[1] ?? ''
}

/** Find an unread post in view, or the lowest visible post when all were seen. */
export async function visibleFeedPost(page: Page, seen: ReadonlySet<string>): Promise<{ locator: Locator; id: string } | null> {
  const articles = page.locator('article')
  const count = await articles.count().catch(() => 0)
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 }
  let fallback: { locator: Locator; id: string } | null = null
  for (let i = 0; i < count; i++) {
    const locator = articles.nth(i)
    const box = await locator.boundingBox().catch(() => null)
    if (!box || box.y >= viewport.height * 0.65 || box.y + box.height <= viewport.height * 0.3) continue
    const id = await postId(locator)
    fallback = { locator, id }
    if (!id || !seen.has(id)) return fallback
  }
  return fallback
}

async function browseFeedSession(
  page: Page,
  minutes: number,
  config: Record<string, unknown>,
  log: ActionLogger,
  shouldStop: StopCheck,
  session: BrowseSession,
  budget?: WarmupActivityBudget,
  matchesTopic: TopicMatcher = topicContentMatches,
): Promise<'finished' | 'stopped' | 'stalled'> {
  if (!(minutes > 0) || shouldStop()) return 'stopped'
  if (config.browse_home_feed === false) return 'finished'
  const start = Date.now()
  const end = session.end
  const sleep = session.wait
  await page.goto('https://www.instagram.com/', {
    waitUntil: 'domcontentloaded',
    timeout: session.timeout(45_000),
  })
  // Wheel/key input only scrolls the feed when the cursor is over page
  // content and the address bar is blurred. Re-focus after every
  // navigation since goto can return focus to browser chrome.
  session.check()
  await focusPageContent(page)
  await dismissPopups(page, session)
  // Let the feed render before touching anything; humans wait for content.
  await page
    .locator('article')
    .first()
    .waitFor({ state: 'visible', timeout: session.timeout(15_000) })
    .catch(() => undefined)
  await dismissPopups(page, session)
  await driftMouse(page, undefined, undefined, session)
  await sleep(random(800, 2000))

  const viewMin = Math.max(0, numeric(config.post_view_min_seconds, 2))
  const viewMax = Math.max(viewMin, numeric(config.post_view_max_seconds, 5))
  const skipMax = Math.max(
    1,
    Math.floor(numeric(config.skip_post_max, 2)),
  )
  const carouselMax = Math.max(
    1,
    Math.floor(numeric(config.carousel_max_slides, 3)),
  )

  const durationMs = Math.max(1, end - start)
  const topics = warmupTopics(config.warmup_topics)
  let skipsRemaining = 0
  // Detect lack of scroll progress, including skips and already-seen posts.
  let stuckRounds = 0
  let lastPosition = ''
  let reloaded = false
  let detours = 0
  const MAX_DETOURS = 3
  const detourSpacing = detourDelay(durationMs)
  let nextDetourAt = start + detourSpacing
  // Permalink ids already dwelled on; never read the same post twice.
  const seen = new Set<string>()
  let feedEnds = 0
  log({ event: 'automation.actions.feed.starting_feed_session_for', message: `Starting feed session for ${minutes} minute(s)` })
  while (Date.now() < end && !shouldStop()) {
    session.check()
    await assertInstagramReady(page)
    if (await dismissPopups(page, session)) {
      stuckRounds = 0
      lastPosition = ''
      continue
    }
    if (await isFeedEnd(page)) {
      feedEnds++
      log({ event: 'automation.actions.feed.feed_end_reached_looking_for', message: 'Feed end reached, looking for more' })
      await smoothScroll(page, random(600, 1000), session)
      await sleep(random(1500, 3000))
      await page
        .locator('article')
        .first()
        .waitFor({ state: 'visible', timeout: session.timeout(5_000) })
        .catch(() => undefined)
      await dismissPopups(page, session)
      if (config.scroll_reels !== false && feedEnds >= 2 && end - Date.now() > 30_000 && !shouldStop() && (!budget || budget.remaining('reels') > 0)) {
        const reels = Math.round(random(numeric(config.reels_min, 3), numeric(config.reels_max, 8)))
        if (await openReels(page, log, session)) {
          log({ event: 'automation.actions.feed.watching_reels', message: 'Watching reels' })
          await watchReels(page, reels, config, log, shouldStop, end, session, budget, matchesTopic)
          await backToFeed(page, log, session)
          session.check()
          await focusPageContent(page)
          await dismissPopups(page, session)
        }
        feedEnds = 0
      }
      stuckRounds = 0
      lastPosition = ''
      if (end - Date.now() < 10_000) break
      continue
    }
    feedEnds = 0
    const position = await page.evaluate(() => `${window.scrollY}:${document.documentElement.scrollHeight}`).catch(() => '')
    stuckRounds = position && position === lastPosition ? stuckRounds + 1 : 0
    lastPosition = position
    if (stuckRounds >= 3) {
      if (await dismissPopups(page, session)) {
        stuckRounds = 0
        lastPosition = ''
        continue
      }
      if (reloaded) {
        log({ event: 'automation.actions.feed.feed_stuck_ending_early', message: 'Feed stuck, ending early' })
        return 'stalled'
      }
      reloaded = true
      stuckRounds = 0
      lastPosition = ''
      log({ event: 'automation.actions.feed.feed_stalled_reloading_once', message: 'Feed stalled, reloading once' })
      await page.reload({ waitUntil: 'domcontentloaded', timeout: session.timeout(15_000) })
      session.check()
      await focusPageContent(page)
      await dismissPopups(page, session)
      await page
        .locator('article')
        .first()
        .waitFor({ state: 'visible', timeout: session.timeout(15_000) })
        .catch(() => undefined)
      await dismissPopups(page, session)
      continue
    }
    const visible = await visibleFeedPost(page, seen)
    if (!visible) {
      await smoothScroll(page, random(450, 750), session)
      await sleep(random(300, 700))
      continue
    }
    const target = visible.locator
    const targetId = visible.id

    // Already read this one (Back nav landing or short scroll): nudge
    // forward instead of dwelling on it again.
    if (targetId && seen.has(targetId)) {
      await advanceFeedPost(page, target, session, budget)
      continue
    }

    const context = await target.evaluate(feedPostContext).catch(() => ({
      text: '', relationship: 'unknown' as const, sponsored: false,
    }))
    const preserveFollowed = context.relationship !== 'not-followed'
    if (preserveFollowed) skipsRemaining = 0

    // Ads remain excluded, including ads from followed authors.
    if (context.sponsored || await isAdPost(target)) {
      if (targetId) seen.add(targetId)
      await advanceFeedPost(page, target, session, budget)
      continue
    }

    // Inspect each author between bored skips, so batches cannot skip followed accounts.
    if (!preserveFollowed && (skipsRemaining > 0 || chance(config.skip_post_chance))) {
      if (!skipsRemaining) skipsRemaining = Math.round(random(1, skipMax))
      skipsRemaining--
      if (targetId) seen.add(targetId)
      await advanceFeedPost(page, target, session, budget)
      continue
    }

    const related = !preserveFollowed && topics.length > 0 && await matchesTopic(context, topics, session, log)
    if (!feedPostMatches(context, topics, related)) {
      if (targetId) seen.add(targetId)
      log({ event: 'automation.warmup.feed_post_off_topic', message: 'Skipped a recommended post outside the selected topics' })
      await advanceFeedPost(page, target, session, budget)
      continue
    }

    // Settle the post fully into view before reading or touching it.
    await alignPostOnScreen(page, target, session)
    if (targetId) seen.add(targetId)

    // Quiet viewing, with longer waits for video content.
    // Session curve: slower mid-session, faster at start/end.
    const progress = Math.min(
      1,
      Math.max(0, (Date.now() - start) / durationMs),
    )
    const sessionScale = 1 + 0.5 * Math.sin(progress * Math.PI)
    let dwell: number
    if (await hasVideo(target)) {
      // Video/reel: watch a human share of the actual clip length.
      const clip = await videoDuration(target).catch(() => 0)
      dwell =
        (clip > 0
          ? Math.min(Math.max(viewMin, clip * random(0.5, 1)), 20)
          : random(Math.max(viewMin, 5), Math.max(viewMax, 12))) *
        1000 *
        sessionScale
    } else {
      dwell = random(viewMin, viewMax) * 1000 * sessionScale
    }
    if (Math.random() < 0.08) dwell *= random(2, 3) // found something interesting
    const choices = postChoices(config)
    // Week-one engagement is handled separately; maintenance engages only eligible content.
    const viewed = await viewContent(target, dwell, session)
    if (viewed && budget) budget.browsed++
    if (viewed && choices.carousel) {
      const slides = Math.floor(random(1, carouselMax + 1))
      for (let i = 0; i < slides; i++) {
        session.check()
        const selector = 'button[aria-label*="Next"], [aria-label="Next"]'
        if (!await clickVisible(target, selector, session).catch(() => false)) break
        await session.wait(random(900, 2200))
      }
    }
    if (viewed && numeric(config.warmup_day, 1) >= 8 && budget)
      await maintainPost(page, target, context, topics, budget, session, log, matchesTopic)
    session.check()
    await assertInstagramReady(page)
    // Re-read geometry after carousel/reveal scrolling, not before.
    const targetBox = await target.boundingBox().catch(() => null)
    const vpSize = page.viewportSize() ?? { width: 1280, height: 800 }
    const targetOnScreen = !!targetBox && clickPointOnScreen(targetBox, vpSize)

    // Space detours across the session. Only successful visits use a slot.
    const canDetour =
      detours < MAX_DETOURS && Date.now() >= nextDetourAt && end - Date.now() > 15_000 && !shouldStop()
    let detoured = false
    let openedDetour = false
    // A failed attempt also waits before retrying, but does not use a success slot.
    if (canDetour && chance(config.own_profile_chance ?? 10)) {
      detoured = true
      if (await openOwnProfile(page, log, session)) {
        openedDetour = true
        log({ event: 'automation.actions.feed.looking_around_own_profile', message: 'Looking around own profile' })
        await wanderProfile(page, log, shouldStop, end, session)
      }
    } else if (canDetour && chance(config.dm_chance ?? 8)) {
      detoured = true
      if (await openDMs(page, log, session)) {
        openedDetour = true
        // From inbox: back to feed, or via own profile from the sidebar.
        if (Math.random() < 0.5 && (await openOwnProfile(page, log, session))) {
          log({ event: 'automation.actions.feed.looking_around_own_profile', message: 'Looking around own profile' })
          await wanderProfile(page, log, shouldStop, end, session)
        }
      }
    } else if (config.scroll_reels !== false && canDetour && (!budget || budget.remaining('reels') > 0) && chance(config.reels_chance ?? 12)) {
      detoured = true
      // Sidebar Reels, watch a few, Back/Home returns to the feed.
      const reels = Math.round(
        random(numeric(config.reels_min, 3), numeric(config.reels_max, 8)),
      )
      if (await openReels(page, log, session)) {
        openedDetour = true
        log({ event: 'automation.actions.feed.watching_reels', message: 'Watching reels' })
        await watchReels(page, reels, config, log, shouldStop, end, session, budget, matchesTopic)
      }
    } else if (
      canDetour &&
      targetOnScreen &&
      (!budget || budget.remaining('profiles') > 0) &&
      chance(config.profile_visit_chance ?? 35)
    ) {
      // Rabbit hole: visit the author or a liker/commenter without engagement.
      detoured = true
      const viaVisitor = Math.random() < 0.5
      log({ event: 'automation.actions.feed.detail', message: viaVisitor ? 'Opening a liker profile' : 'Opening the author profile' })
      const opened = viaVisitor
        ? await openVisitorProfile(page, target, session)
        : await openAuthorProfile(page, target, session)
      if (opened) {
        budget?.take('profiles')
        openedDetour = true
        log({ event: 'automation.actions.feed.looking_around_the_profile', message: 'Looking around the profile' })
        await wanderProfile(page, log, shouldStop, end, session)
      }
    }
    if (detoured) {
      if (openedDetour) detours++
      nextDetourAt = Date.now() + detourSpacing
      session.check()
      // Re-anchor to the feed the human way: browser Back, then Home.
      await backToFeed(page, log, session)
      session.check()
      await focusPageContent(page)
      await dismissPopups(page, session)
      await page
        .locator('article')
        .first()
        .waitFor({ state: 'visible', timeout: session.timeout(15_000) })
        .catch(() => undefined)
      await dismissPopups(page, session)
      await driftMouse(page, undefined, undefined, session)
      await sleep(random(800, 2000))
      stuckRounds = 0
      continue
    }

    if (Date.now() >= end || shouldStop()) break
    await advanceFeedPost(page, target, session, budget)


  }
  log({ event: 'automation.actions.feed.feed_session_finished', message: 'Feed session finished' })
  return shouldStop() ? 'stopped' : 'finished'
}

export async function browseFeed(
  page: Page, minutes: number, config: Record<string, unknown>,
  log: ActionLogger, shouldStop: StopCheck,
  budget?: WarmupActivityBudget,
  matchesTopic: TopicMatcher = topicContentMatches,
): Promise<'finished' | 'stopped' | 'stalled'> {
  if (!(minutes > 0) || shouldStop()) return 'stopped'
  const session = new BrowseSession(Date.now() + minutes * 60_000, shouldStop)
  try {
    return await browseFeedSession(page, minutes, config, log, shouldStop, session, budget, matchesTopic)
  } catch (error) {
    if (error instanceof SessionEnded || session.stopped())
      return shouldStop() ? 'stopped' : 'finished'
    throw error
  }
}
