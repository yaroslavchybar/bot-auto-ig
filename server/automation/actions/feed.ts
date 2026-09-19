import type { Locator, Page } from 'playwright-core'
import { focusPageContent } from '../../browser/focus.js'
import {
  chance,
  numeric,
  random,
  sleep,
  type ActionLogger,
  type StopCheck,
} from './shared.js'
import { clickPointOnScreen } from './guards.js'
import {
  clickVisible,
  driftMouse,
  followVisible,
  hoverPost,
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

// 50/50 like style: double-tap photo center (human default) vs Like button.
// Double-tap goes through real mouse input; falls back to button on failure.
async function likePost(page: Page, target: Locator): Promise<boolean> {
  let box
  try {
    box = await target.boundingBox()
  } catch {
    return false
  }
  const vp = page.viewportSize() ?? { width: 1280, height: 800 }
  // Off-screen target: skip instead of flying the cursor to the top.
  if (!box || !clickPointOnScreen(box, vp)) return false
  // Double-tap opens video posts in reels view; Like button only there.
  const video = await hasVideo(target).catch(() => false)
  if (!video && Math.random() < 0.5) {
    try {
      const x = box.x + box.width * random(0.35, 0.65)
      const y = box.y + Math.min(box.height * random(0.35, 0.6), 500)
      await page.mouse.move(x, y)
      await sleep(random(150, 400))
      await page.mouse.dblclick(x, y)
      return true
    } catch {
      // Fall through to button click.
    }
  }
  // Like button below the fold: glide it into view instead of skipping
  // the like or letting Playwright jump-scroll to it.
  await revealForClick(
    page,
    target.locator('svg[aria-label="Like"], button[aria-label="Like"]').first(),
  ).catch(() => false)
  return likeVisible(target).catch(() => false)
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

export async function browseFeed(
  page: Page,
  minutes: number,
  config: Record<string, unknown>,
  log: ActionLogger,
  shouldStop: StopCheck,
): Promise<'finished' | 'stopped' | 'stalled'> {
  if (!(minutes > 0) || shouldStop()) return 'stopped'
  const start = Date.now()
  const end = start + minutes * 60_000
  await page.goto('https://www.instagram.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  })
  // Wheel/key input only scrolls the feed when the cursor is over page
  // content and the address bar is blurred. Re-focus after every
  // navigation since goto can return focus to browser chrome.
  await focusPageContent(page)
  // Let the feed render before touching anything; humans wait for content.
  await page
    .locator('article')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => undefined)
  await driftMouse(page)
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
  // Permalink ids already dwelled on; never read the same post twice.
  const seen = new Set<string>()
  log(`Starting feed session for ${minutes} minute(s)`)
  while (Date.now() < end && !shouldStop()) {
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
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 })
      await focusPageContent(page)
      continue
    }
    const visible = await visibleFeedPost(page, seen)
    if (!visible) {
      await smoothScroll(page, random(450, 750))
      await sleep(random(300, 700))
      continue
    }
    const target = visible.locator
    const targetId = visible.id

    // Already read this one (Back nav landing or short scroll): nudge
    // forward instead of dwelling and liking it again.
    if (targetId && seen.has(targetId)) {
      await smoothScroll(page, random(600, 1000))
      await sleep(random(300, 700))
      continue
    }

    // Bored skip: glide past posts fast without reading.
    if (chance(config.skip_post_chance)) {
      const skips = Math.round(random(1, skipMax))
      for (let i = 0; i < skips && Date.now() < end && !shouldStop(); i++) {
        await smoothScroll(page, random(450, 950))
        await sleep(random(300, 900))
      }
      continue
    }

    // Ads / suggested posts: fast-scroll past, never engage.
    if (await isPromoPost(target)) {
      await smoothScroll(page, random(500, 950))
      await sleep(random(300, 800))
      continue
    }

    // Settle the post fully into view before reading or touching it.
    await alignPostOnScreen(page, target)
    if (targetId) seen.add(targetId)

    // Dwell on the post like reading. Split into slices so micro-behaviors
    // (hover, tiny scroll, carousel) can happen mid-read.
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
    // Clicks on an off-screen target jump-scroll the page and fly the
    // cursor; only like/follow/swipe when the post is actually visible.
    const vpSize = page.viewportSize() ?? { width: 1280, height: 800 }
    const targetBox = await target.boundingBox().catch(() => null)
    const targetOnScreen =
      !!targetBox && clickPointOnScreen(targetBox, vpSize)
    const sliceEnd = Date.now() + dwell
    let engaged = false
    let carouselDone = false
    let likedThisPost = false
    while (Date.now() < sliceEnd && Date.now() < end && !shouldStop()) {
      await sleep(random(400, 1100))
      if (Date.now() >= end || shouldStop()) break
      const roll = Math.random()
      if (!engaged) {
        engaged = true
        // One decision per post: like and/or follow, on the viewed post.
        if (targetOnScreen && chance(config.like_chance))
          likedThisPost =
            (await likePost(page, target).catch(() => false)) || false
        if (targetOnScreen && chance(config.follow_chance))
          await followVisible(target).catch(() => undefined)
      } else if (
        !carouselDone &&
        targetOnScreen &&
        chance(config.carousel_watch_chance)
      ) {
        carouselDone = true
        // Swipe carousels with the on-screen arrow (real click, no JS).
        const slides = Math.round(random(1, carouselMax))
        for (let s = 0; s < slides && Date.now() < end && !shouldStop(); s++) {
          const selector = 'button[aria-label*="Next"], [aria-label="Next"]'
          const next = target.locator(selector)
          if (!(await next.count().catch(() => 0))) break
          const clicked = await clickVisible(target, selector).catch(
            () => false,
          )
          if (!clicked) break
          await sleep(random(900, 2200))
        }
      } else if (roll < 0.25) {
        // Adjust position mid-read with a tiny glide.
        await smoothScroll(page, random(-70, 90))
      } else if (roll < 0.45) {
        await hoverPost(page, target)
      }
      // Else: just stare at the post, do nothing.
    }

    // Detours: own profile, DMs, reels, or someone else's profile — checked
    // rarest first so each gets a fair shot. All UI-driven, all lead home.
    const canDetour =
      detours < MAX_DETOURS && Date.now() < end && !shouldStop()
    let detoured = false
    if (canDetour && chance(config.own_profile_chance ?? 10)) {
      detours++
      detoured = true
      if (await openOwnProfile(page, log)) {
        log('Looking around own profile')
        await wanderProfile(page, log, shouldStop, end)
      }
    } else if (canDetour && chance(config.dm_chance ?? 8)) {
      detours++
      detoured = true
      if (await openDMs(page, log)) {
        // From inbox: back to feed, or via own profile from the sidebar.
        if (Math.random() < 0.5 && (await openOwnProfile(page, log))) {
          log('Looking around own profile')
          await wanderProfile(page, log, shouldStop, end)
        }
      }
    } else if (canDetour && chance(config.reels_chance ?? 12)) {
      detours++
      detoured = true
      // Sidebar Reels, watch a few, Back/Home returns to the feed.
      const reels = Math.round(
        random(numeric(config.reels_min, 3), numeric(config.reels_max, 8)),
      )
      if (await openReels(page, log)) {
        log('Watching reels')
        await watchReels(page, reels, config, log, shouldStop, end)
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
      detours++
      detoured = true
      // Liked the post → visit its author; otherwise 50/50 author/visitor.
      const viaVisitor = !likedThisPost && Math.random() < 0.5
      log(
        viaVisitor ? 'Opening a liker profile' : 'Opening the author profile',
      )
      const opened = viaVisitor
        ? await openVisitorProfile(page, target)
        : await openAuthorProfile(page, target)
      if (opened) {
        log('Looking around the profile')
        await wanderProfile(page, log, shouldStop, end)
      }
    }
    if (detoured) {
      // Re-anchor to the feed the human way: browser Back, then Home.
      await backToFeed(page, log)
      await focusPageContent(page)
      await page
        .locator('article')
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 })
        .catch(() => undefined)
      await driftMouse(page)
      await sleep(random(800, 2000))
      stuckRounds = 0
      continue
    }

    if (Date.now() >= end || shouldStop()) break
    await scrollPastPost(page, cursor, targetBox?.height ?? 0)


  }
  log('Feed session finished')
  return shouldStop() ? 'stopped' : 'finished'
}
