import type { Locator, Page } from 'playwright-core'
import { sleep } from '../browser/lifecycle.js'
import {
  instagramAccountUpdateMessage,
  instagramAccountUpdateStatus,
  instagramAccountsForProfile,
  instagramAccountsToMessage,
  messageTemplatesGet,
} from '../shared/convexClient.js'

export type ActionLogger = (message: string) => void
export type StopCheck = () => boolean

const random = (min: number, max: number) =>
  min + Math.random() * Math.max(0, max - min)
const chance = (value: unknown) =>
  Math.random() * 100 < Math.max(0, Math.min(100, Number(value) || 0))
const numeric = (value: unknown, fallback: number) =>
  value == null || !Number.isFinite(Number(value)) ? fallback : Number(value)

async function randomDelay(min: number, max: number): Promise<void> {
  await sleep(random(min, max) * 1000)
}

async function clickVisible(
  page: Page | Locator,
  selector: string,
): Promise<boolean> {
  const locator = 'locator' in page ? page.locator(selector) : page
  for (let i = 0; i < Math.min(await locator.count(), 5); i++) {
    const item = locator.nth(i)
    if (await item.isVisible().catch(() => false)) {
      await item.click({ timeout: 5_000 })
      return true
    }
  }
  return false
}

async function likeVisible(page: Page | Locator): Promise<boolean> {
  return clickVisible(page, 'svg[aria-label="Like"], button[aria-label="Like"]')
}

async function followVisible(page: Page | Locator): Promise<boolean> {
  return clickVisible(
    page,
    'button:text-is("Follow"), div[role="button"]:text-is("Follow"), button:text-is("Follow Back"), div[role="button"]:text-is("Follow Back")',
  )
}

// Park the cursor somewhere neutral. A single move call lets Camoufox draw
// its own human curve instead of our linear interpolation.
async function driftMouse(page: Page, x?: number, y?: number): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 }
  try {
    await page.mouse.move(
      x ?? random(viewport.width * 0.3, viewport.width * 0.7),
      y ?? random(viewport.height * 0.3, viewport.height * 0.7),
    )
  } catch {
    // Mouse may be unavailable in some contexts; scrolling still works.
  }
}

// Smooth, trackpad-like scroll using only real wheel events (never JS).
// Emits many tiny deltas on a ~60Hz cadence with an ease-in-out velocity
// profile, so the page glides instead of jumping in chunks.
async function smoothScroll(page: Page, total: number): Promise<void> {
  const dir = Math.sign(total) || 1
  const dist = Math.abs(total)
  if (dist < 1) return
  const duration = Math.min(1500, Math.max(250, dist * random(1.0, 1.8)))
  const frames = Math.max(8, Math.floor(duration / random(14, 30)))
  let emitted = 0
  for (let i = 0; i < frames; i++) {
    const t = (i + 1) / frames
    // ease-in-out: slow start, fast middle, gentle settle.
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    const delta = Math.max(
      1,
      Math.round((eased * dist - emitted) * random(0.7, 1.3)),
    )
    emitted += delta
    await page.mouse.wheel(0, delta * dir).catch(() => undefined)
    await sleep(random(12, 32))
  }
}

// Sometimes humans use keys instead of the wheel. Rare; mouse owns scrolling.
async function keyScroll(page: Page): Promise<void> {
  const roll = Math.random()
  const key =
    roll < 0.45 ? 'Space' : roll < 0.65 ? 'PageDown' : roll < 0.88 ? 'ArrowDown' : 'ArrowUp'
  await page.keyboard.press(key).catch(() => undefined)
  await sleep(random(250, 700))
  // Key presses jump far; humans often correct with a small wheel move after.
  if (Math.random() < 0.5) {
    await smoothScroll(page, random(40, 160))
    await sleep(random(120, 350))
  }
}

// Grab the scrollbar and drag it, like a mouse user. Every move goes through
// Camoufox's humanized cursor. Leaves the cursor parked on the scrollbar.
async function dragScrollbar(page: Page): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 }
  const x = viewport.width - random(4, 12)
  const startY = random(viewport.height * 0.3, viewport.height * 0.6)
  const travel = random(120, 320)
  try {
    await page.mouse.move(x, startY)
    await sleep(random(120, 350))
    await page.mouse.down()
    const legs = Math.round(random(3, 6))
    for (let i = 1; i <= legs; i++) {
      await page.mouse.move(x, startY + (travel * i) / legs)
      await sleep(random(30, 80))
    }
    await sleep(random(100, 300))
    await page.mouse.up()
  } catch {
    // Drags can fail if the page navigated; wheel still works.
  }
}

type CursorState = { onScrollbar: boolean }

// Scroll past the current post the way a mouse user would: the cursor sits
// over the content and the wheel does the work, with an occasional scrollbar
// drag or key press for variety. Hesitates, then moves on.
async function scrollPastPost(page: Page, cursor: CursorState): Promise<void> {
  const roll = Math.random()
  if (roll < 0.12) {
    await dragScrollbar(page)
    cursor.onScrollbar = true
  } else {
    if (cursor.onScrollbar) {
      // Wheel-scrolls originate where the cursor points; move back to content.
      await driftMouse(page)
      cursor.onScrollbar = false
      await sleep(random(150, 400))
    }
    if (roll < 0.22) {
      await keyScroll(page)
    } else {
      await smoothScroll(page, random(400, 900))
    }
  }
  // Hesitation: short pause, sometimes a second tiny nudge.
  await sleep(random(200, 700))
  if (Math.random() < 0.3) {
    await smoothScroll(page, random(30, 120))
    await sleep(random(150, 400))
  }
  // Re-read: glide back up a bit.
  if (Math.random() < 0.12) {
    await sleep(random(300, 900))
    await smoothScroll(page, -random(80, 220))
  }
}

async function hoverPost(
  page: Page,
  target: Locator,
): Promise<void> {
  try {
    const box = await target.boundingBox()
    if (!box) return
    // Single move: Camoufox draws the human curve.
    await page.mouse.move(
      box.x + box.width * random(0.3, 0.7),
      box.y + Math.min(box.height * random(0.3, 0.6), 500),
    )
  } catch {
    // Post may have scrolled away; safe to ignore.
  }
}

export async function browseFeed(
  page: Page,
  minutes: number,
  config: Record<string, unknown>,
  log: ActionLogger,
  shouldStop: StopCheck,
): Promise<void> {
  await page.goto('https://www.instagram.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  })
  const duration = Math.max(0, minutes)
  if (!(duration > 0)) {
    log('Feed session skipped (0 minutes)')
    return
  }
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

  const end = Date.now() + duration * 60_000
  const cursor: CursorState = { onScrollbar: false }
  log(`Starting feed session for ${minutes} minute(s)`)
  while (Date.now() < end && !shouldStop()) {
    const articles = page.locator('article')
    const count = await articles.count().catch(() => 0)

    // Pick the post actually in view (not always the first) via layout boxes.
    // boundingBox() only observes layout; scrolling stays input-only.
    let target = articles.first()
    if (count > 1) {
      const viewport = page.viewportSize() ?? { height: 800 }
      const check = Math.min(count, 6)
      for (let i = 0; i < check; i++) {
        const candidate = articles.nth(i)
        const box = await candidate.boundingBox().catch(() => null)
        if (
          box &&
          box.y > 50 &&
          box.y < viewport.height * 0.65
        ) {
          target = candidate
          break
        }
      }
    }

    // Bored skip: glide past posts fast without reading.
    if (count && chance(config.skip_post_chance)) {
      const skips = Math.round(random(1, skipMax))
      for (let i = 0; i < skips && Date.now() < end && !shouldStop(); i++) {
        await smoothScroll(page, random(450, 950))
        await sleep(random(300, 900))
      }
      continue
    }

    // Dwell on the post like reading. Split into slices so micro-behaviors
    // (hover, tiny scroll, carousel) can happen mid-read.
    let dwell = random(viewMin, viewMax) * 1000
    if (Math.random() < 0.08) dwell *= random(2, 3) // found something interesting
    const sliceEnd = Date.now() + dwell
    let engaged = false
    let carouselDone = false
    while (Date.now() < sliceEnd && Date.now() < end && !shouldStop()) {
      await sleep(random(400, 1100))
      const roll = Math.random()
      if (!engaged && count) {
        engaged = true
        // One decision per post: like and/or follow, on the viewed post.
        if (chance(config.like_chance))
          await likeVisible(target).catch(() => undefined)
        if (chance(config.follow_chance))
          await followVisible(target).catch(() => undefined)
      } else if (!carouselDone && count && chance(config.carousel_watch_chance)) {
        carouselDone = true
        // Swipe carousels with the on-screen arrow (real click, no JS).
        const slides = Math.round(random(1, carouselMax))
        for (let s = 0; s < slides; s++) {
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

    if (Date.now() >= end || shouldStop()) break
    await scrollPastPost(page, cursor)
  }
  log('Feed session finished')
}

export async function browseReels(
  page: Page,
  minutes: number,
  config: Record<string, unknown>,
  log: ActionLogger,
  shouldStop: StopCheck,
): Promise<void> {
  await page.goto('https://www.instagram.com/reels/', {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  })
  const end = Date.now() + Math.max(0, minutes) * 60_000
  log(`Starting reels session for ${minutes} minute(s)`)
  while (Date.now() < end && !shouldStop()) {
    const skip = chance(config.reels_skip_chance)
    const minWatch = skip
      ? Number(config.reels_skip_min_time)
      : Number(config.reels_normal_min_time)
    const maxWatch = skip
      ? Number(config.reels_skip_max_time)
      : Number(config.reels_normal_max_time)
    await sleep(random(minWatch || 1, maxWatch || 3) * 1000)
    if (chance(config.reels_like_chance)) await likeVisible(page)
    if (chance(config.reels_follow_chance)) await followVisible(page)
    await clickVisible(
      page,
      '[aria-label*="Next Reel"], [aria-label*="next Reel"]',
    )
    await randomDelay(
      Number(config.reels_advance_min_seconds) || 1,
      Number(config.reels_advance_max_seconds) || 3,
    )
  }
  log('Reels session finished')
}

export async function watchStories(
  page: Page,
  maxStories: number,
  log: ActionLogger,
  shouldStop: StopCheck,
): Promise<void> {
  await page.goto('https://www.instagram.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  })
  const story = page.locator('a[href*="/stories/"]').first()
  if (!(await story.isVisible().catch(() => false))) {
    log('Stories: no story tray found')
    return
  }
  await story.click()
  let watched = 0
  while (watched < Math.max(0, maxStories) && !shouldStop()) {
    await randomDelay(2, 5)
    watched++
    await clickVisible(page, '[aria-label*="Next"], button:has-text("Next")')
  }
  await page.keyboard.press('Escape').catch(() => undefined)
  log(`Stories: watched ${watched}`)
}

async function processProfiles(
  profileId: string,
  status: 'assigned' | 'subscribed',
  shouldStop: StopCheck,
  action: (username: string) => Promise<boolean>,
  config: Record<string, unknown>,
): Promise<void> {
  const accounts = await instagramAccountsForProfile(profileId, status)
  const prefix = status === 'assigned' ? 'follow' : 'unfollow'
  const min = Math.max(0, Math.floor(numeric(config[`${prefix}_min_count`], 5)))
  const max = Math.max(
    min,
    Math.floor(numeric(config[`${prefix}_max_count`], 15)),
  )
  const limit = Math.floor(random(min, max + 1))
  let completed = 0
  for (const account of accounts) {
    if (shouldStop() || completed >= limit) break
    const username = String(account.user_name || '')
      .replace(/^@/, '')
      .trim()
    if (!username) continue
    if (await action(username)) {
      await instagramAccountUpdateStatus(
        account.id,
        status === 'assigned' ? 'subscribed' : 'unsubscribed',
      )
      completed++
    }
    if (completed < limit)
      await randomDelay(
        numeric(config[`${prefix}_min_delay_seconds`] ?? config.min_delay, 10),
        numeric(config[`${prefix}_max_delay_seconds`] ?? config.max_delay, 20),
      )
  }
}

export async function followUsers(
  page: Page,
  profileId: string,
  log: ActionLogger,
  shouldStop: StopCheck,
  config: Record<string, unknown> = {},
): Promise<void> {
  await processProfiles(
    profileId,
    'assigned',
    shouldStop,
    async (username) => {
      await page.goto(
        `https://www.instagram.com/${encodeURIComponent(username)}/`,
        { waitUntil: 'domcontentloaded', timeout: 20_000 },
      )
      const result = await followVisible(page)
      if (result) log(`Followed @${username}`)
      return result
    },
    config,
  )
}

export async function unfollowUsers(
  page: Page,
  profileId: string,
  log: ActionLogger,
  shouldStop: StopCheck,
  config: Record<string, unknown> = {},
): Promise<void> {
  await processProfiles(
    profileId,
    'subscribed',
    shouldStop,
    async (username) => {
      await page.goto(
        `https://www.instagram.com/${encodeURIComponent(username)}/`,
        { waitUntil: 'domcontentloaded', timeout: 20_000 },
      )
      const result = await clickVisible(
        page,
        'button:has-text("Following"), div[role="button"]:has-text("Following")',
      )
      if (result) {
        if (
          !(await clickVisible(
            page,
            'button:text-is("Unfollow"), div[role="button"]:text-is("Unfollow")',
          ))
        )
          return false
        log(`Unfollowed @${username}`)
      }
      return result
    },
    config,
  )
}

export async function approveRequests(
  page: Page,
  log: ActionLogger,
  shouldStop: StopCheck,
): Promise<void> {
  await page.goto('https://www.instagram.com/accounts/activity/', {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  })
  const buttons = page.locator(
    'button:has-text("Confirm"), div[role="button"]:has-text("Confirm")',
  )
  const count = await buttons.count()
  for (let i = 0; i < count && !shouldStop() && (await buttons.count()); i++) {
    await buttons.first().click()
    await randomDelay(1, 2)
  }
  log('Follow request approval finished')
}

export async function sendMessages(
  page: Page,
  profileId: string,
  log: ActionLogger,
  shouldStop: StopCheck,
  config: Record<string, unknown> = {},
): Promise<void> {
  const cooldown = config.messaging_cooldown_enabled
    ? Math.max(0, Number(config.messaging_cooldown_hours) || 0)
    : 0
  const targets = await instagramAccountsToMessage(profileId, cooldown)
  const templates = await messageTemplatesGet(
    String(config.template_kind || 'message'),
  )
  if (!templates.length) {
    log('Messaging skipped: no message templates configured')
    return
  }
  for (const target of targets) {
    if (shouldStop()) break
    const username = String(target.user_name || '')
      .replace(/^@/, '')
      .trim()
    if (!username) continue
    await page.goto(
      `https://www.instagram.com/${encodeURIComponent(username)}/`,
      { waitUntil: 'domcontentloaded', timeout: 20_000 },
    )
    if (
      await clickVisible(
        page,
        'button:has-text("Message"), div[role="button"]:has-text("Message")',
      )
    ) {
      const input = page.locator('textarea, [contenteditable="true"]').last()
      await input.fill(templates[Math.floor(Math.random() * templates.length)])
      await input.press('Enter')
      await instagramAccountUpdateMessage(username)
      log(`Sent message to @${username}`)
    }
    await randomDelay(2, 5)
  }
}
