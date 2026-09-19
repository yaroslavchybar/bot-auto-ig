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
  followVisible,
  likeVisible,
} from './mouse.js'
import {
  alignPostOnScreen,
  revealForClick,
  scrollPastPost,
  smoothScroll,
  type CursorState,
} from './scroll.js'
import { backToFeed } from './navigation.js'
import {
  openAuthorProfile,
  openOwnProfile,
  openVisitorProfile,
  wanderProfile,
} from './profiles.js'
import { openDMs } from './inbox.js'
import { openReels, watchReels } from './reels.js'

// Use the verified Like control; never double-click an arbitrary article region.
async function likePost(page: Page, target: Locator, session: BrowseSession): Promise<boolean> {
  if (await target.locator('svg[aria-label="Unlike"]').count()) return false
  const button = target.locator('div[role="button"]:has(svg[aria-label="Like"]), button:has(svg[aria-label="Like"])').first()
  if (!await revealForClick(page, button, session)) return false
  return likeVisible(target, session)
}

// Promo posts (ads / suggested) get scrolled past, never engaged with.
// Text markers plus structural ones: ad redirect links and tracking
// query params on profile links (normal post links are always clean).
async function isPromoPost(target: Locator): Promise<boolean> {
  try {
    if (
      (await target.getByText(/suggested for you|sponsored|learn more/i).count()) > 0
    )
      return true
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
): Promise<'finished' | 'stopped' | 'stalled'> {
  if (!(minutes > 0) || shouldStop()) return 'stopped'
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
  // Let the feed render before touching anything; humans wait for content.
  await page
    .locator('article')
    .first()
    .waitFor({ state: 'visible', timeout: session.timeout(15_000) })
    .catch(() => undefined)
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
  const cursor: CursorState = { onScrollbar: false }
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
  log(`Starting feed session for ${minutes} minute(s)`)
  while (Date.now() < end && !shouldStop()) {
    session.check()
    if (await isFeedEnd(page)) return 'finished'
    const position = await page.evaluate(() => `${window.scrollY}:${document.documentElement.scrollHeight}`).catch(() => '')
    stuckRounds = position && position === lastPosition ? stuckRounds + 1 : 0
    lastPosition = position
    if (stuckRounds >= 3) {
      if (reloaded) {
        log('Feed stuck, ending early')
        return 'stalled'
      }
      reloaded = true
      stuckRounds = 0
      log('Feed stalled, reloading once')
      await page.reload({ waitUntil: 'domcontentloaded', timeout: session.timeout(15_000) })
      session.check()
      await focusPageContent(page)
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
    // forward instead of dwelling and liking it again.
    if (targetId && seen.has(targetId)) {
      await smoothScroll(page, random(600, 1000), session)
      await sleep(random(300, 700))
      continue
    }

    // Bored skip: glide past posts fast without reading.
    if (chance(config.skip_post_chance)) {
      const skips = Math.round(random(1, skipMax))
      for (let i = 0; i < skips && Date.now() < end && !shouldStop(); i++) {
        await smoothScroll(page, random(450, 950), session)
        await sleep(random(300, 900))
      }
      continue
    }

    // Ads / suggested posts: fast-scroll past, never engage.
    if (await isPromoPost(target)) {
      await smoothScroll(page, random(500, 950), session)
      await sleep(random(300, 800))
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
    // Quiet viewing first. Engagement only follows actual viewing/playback.
    const viewed = await viewContent(target, dwell, session)
    let likedThisPost = false
    if (viewed && choices.carousel) {
      const slides = Math.floor(random(1, carouselMax + 1))
      for (let i = 0; i < slides; i++) {
        session.check()
        const selector = 'button[aria-label*="Next"], [aria-label="Next"]'
        if (!await clickVisible(target, selector, session).catch(() => false)) break
        await session.wait(random(900, 2200))
      }
    }
    if (viewed && choices.like)
      likedThisPost = await likePost(page, target, session).catch(() => false)
    if (viewed && choices.follow)
      await followVisible(target, session).catch(() => false)
    session.check()
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
        log('Looking around own profile')
        await wanderProfile(page, log, shouldStop, end, session)
      }
    } else if (canDetour && chance(config.dm_chance ?? 8)) {
      detoured = true
      if (await openDMs(page, log, session)) {
        openedDetour = true
        // From inbox: back to feed, or via own profile from the sidebar.
        if (Math.random() < 0.5 && (await openOwnProfile(page, log, session))) {
          log('Looking around own profile')
          await wanderProfile(page, log, shouldStop, end, session)
        }
      }
    } else if (canDetour && chance(config.reels_chance ?? 12)) {
      detoured = true
      // Sidebar Reels, watch a few, Back/Home returns to the feed.
      const reels = Math.round(
        random(numeric(config.reels_min, 3), numeric(config.reels_max, 8)),
      )
      if (await openReels(page, log, session)) {
        openedDetour = true
        log('Watching reels')
        await watchReels(page, reels, config, log, shouldStop, end, session)
      }
    } else if (
      canDetour &&
      targetOnScreen &&
      chance(
        likedThisPost
          ? (config.liked_profile_visit_chance ?? 80)
          : (config.profile_visit_chance ?? 35),
      )
    ) {
      // Rabbit hole: author or a liker/commenter. Liked posts lead to
      // the author; other posts use the base visit chance.
      detoured = true
      // Liked the post → visit its author; otherwise 50/50 author/visitor.
      const viaVisitor = !likedThisPost && Math.random() < 0.5
      log(
        viaVisitor ? 'Opening a liker profile' : 'Opening the author profile',
      )
      const opened = viaVisitor
        ? await openVisitorProfile(page, target, session)
        : await openAuthorProfile(page, target, session)
      if (opened) {
        openedDetour = true
        log('Looking around the profile')
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
      await page
        .locator('article')
        .first()
        .waitFor({ state: 'visible', timeout: session.timeout(15_000) })
        .catch(() => undefined)
      await driftMouse(page, undefined, undefined, session)
      await sleep(random(800, 2000))
      stuckRounds = 0
      continue
    }

    if (Date.now() >= end || shouldStop()) break
    await scrollPastPost(page, cursor, targetBox?.height ?? 0, session)


  }
  log('Feed session finished')
  return shouldStop() ? 'stopped' : 'finished'
}

export async function browseFeed(
  page: Page, minutes: number, config: Record<string, unknown>,
  log: ActionLogger, shouldStop: StopCheck,
): Promise<'finished' | 'stopped' | 'stalled'> {
  if (!(minutes > 0) || shouldStop()) return 'stopped'
  const session = new BrowseSession(Date.now() + minutes * 60_000, shouldStop)
  try {
    return await browseFeedSession(page, minutes, config, log, shouldStop, session)
  } catch (error) {
    if (error instanceof SessionEnded || session.stopped())
      return shouldStop() ? 'stopped' : 'finished'
    throw error
  }
}
