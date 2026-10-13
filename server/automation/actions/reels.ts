import type { Locator, Page } from 'playwright-core'
import { BrowseSession } from './session.js'
import { viewVideo } from './viewing.js'
import type { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { assertInstagramReady } from './instagram-state.js'
import { warmupTopics, feedPostMatches, reelPostContext } from '../../shared/warmupTopics.js'
import { topicContentMatches, type TopicMatcher } from './topic-intent.js'
import { maintainPost } from './maintenance.js'
import { clickAction } from './action-locator.js'
import {
  chance,
  numeric,
  random,
  type ActionLogger,
  type StopCheck,
} from './shared.js'

const REEL_URL = /\/reels\/([A-Za-z0-9_-]+)\/?/

function reelId(url: string): string {
  return url.match(REEL_URL)?.[1] ?? ''
}

// Sidebar Reels button. UI only, no direct navigation.
export async function openReels(page: Page, log: ActionLogger, session = new BrowseSession()): Promise<boolean> {
  const sleep = session.wait
  session.check()
  try {
    const btn = page.locator('a:has(svg[aria-label="Reels"])').filter({ visible: true }).first()
    if (!(await btn.isVisible().catch(() => false))) return false
    await clickAction(btn, session.timeout(5_000)).catch(() => undefined)
    await sleep(random(1500, 2500))
    // Lands on /reels/ first; the first reel auto-opens right after.
    await page
      .waitForURL(/\/reels\//, { timeout: session.timeout(12_000) })
      .catch(() => undefined)
    if (!/\/reels\//.test(page.url())) {
      // Sidebar shifts while the feed loads; one retry clicks the right spot.
      await clickAction(btn, session.timeout(5_000)).catch(() => undefined)
      await page
        .waitForURL(/\/reels\//, { timeout: session.timeout(12_000) })
        .catch(() => undefined)
    }
    await page
      .locator('video')
      .first()
      .waitFor({ state: 'visible', timeout: session.timeout(15_000) })
      .catch(() => undefined)
    await sleep(random(1500, 2500))
    if (!/\/reels\//.test(page.url())) return false
    log({ event: 'automation.actions.reels.opened_reels', message: 'Opened reels' })
    return true
  } catch {
    return false
  }
}

// Sponsored reel: small "Ad"/"Sponsored" tag under the caption plus a CTA
// button (Listen now, Learn more, ...). Both must be visible — either one
// alone could be a comment or caption word.
async function isAdReel(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      let tag = false
      let cta = false
      const els = document.querySelectorAll('main span, main div, main a')
      for (const el of els) {
        const r = (el as HTMLElement).getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.bottom < 0 || r.top > window.innerHeight) continue
        const t = ((el as HTMLElement).innerText || '').trim()
        if (!t || t.length > 24) continue
        if (/^(ad|sponsored)$/i.test(t)) tag = true
        if (
          /^(listen now|learn more|shop now|install now|sign up|book now|order now|download|play now|get showtimes)$/i.test(
            t,
          )
        )
          cta = true
        if (tag && cta) return true
      }
      return false
    })
  } catch {
    return false
  }
}
// Video filling the screen right now (current + preloaded share the DOM).
async function inViewVideo(page: Page): Promise<Locator | null> {
  try {
    const vids = page.locator('video')
    const n = await vids.count().catch(() => 0)
    const viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    let best: Locator | null = null, bestArea = 0
    for (let i = 0; i < n; i++) {
      const box = await vids.nth(i).boundingBox().catch(() => null)
      if (!box) continue
      const width = Math.max(0, Math.min(viewport.width, box.x + box.width) - Math.max(0, box.x))
      const height = Math.max(0, Math.min(viewport.height, box.y + box.height) - Math.max(0, box.y))
      if (width * height > bestArea) { best = vids.nth(i); bestArea = width * height }
    }
    return best
  } catch {
    return null
  }
}

/** Use the actual scrollport, including nested viewers and headed windows without a fixed viewport. */
function reelViewBounds(video: Element) {
  const view = video.ownerDocument.defaultView!
  for (let parent = video.parentElement; parent; parent = parent.parentElement) {
    if (!/(auto|scroll)/.test(view.getComputedStyle(parent).overflowY) || parent.scrollHeight <= parent.clientHeight) continue
    const box = parent.getBoundingClientRect()
    return { top: Math.max(0, box.top), bottom: Math.min(view.innerHeight, box.bottom) }
  }
  return { top: 0, bottom: view.innerHeight }
}

// A changed URL or a video center anywhere onscreen does not mean snapping has finished.
async function waitForSettle(page: Page, session: BrowseSession): Promise<boolean> {
  const sleep = session.wait
  session.check()
  for (let i = 0; i < 10; i++) {
    const video = await inViewVideo(page)
    const box = await video?.boundingBox()
    const port = await video?.evaluate(reelViewBounds)
    if (box && port && port.bottom > port.top) {
      const height = port.bottom - port.top
      const visible = Math.max(0, Math.min(box.y + box.height, port.bottom) - Math.max(box.y, port.top))
      if (visible >= Math.min(box.height, height) * 0.9 &&
        Math.abs(box.y + box.height / 2 - (port.top + port.bottom) / 2) <= height * 0.15) return true
    }
    await sleep(500)
  }
  return false
}

// Use the named Next control with cursor movement, then verify navigation and settling.
export async function advanceReel(page: Page, session: BrowseSession): Promise<boolean> {
  session.check()
  const before = reelId(page.url())
  const changed = () => { const id = reelId(page.url()); return !!id && id !== before }
  try {
    const next = page.getByRole('button', { name: 'Navigate to next Reel', exact: true }).filter({ visible: true }).first()
    if (!await next.isVisible() || !await next.isEnabled()) return false
    await clickAction(next, session.timeout(5000))
    await page.waitForURL(url => !!reelId(url.href) && reelId(url.href) !== before, { timeout: session.timeout(5000) })
    return await waitForSettle(page, session) && changed()
  } catch {
    return false
  }
}

// Watch a few reels without engagement, then advance to the next.
export async function watchReels(
  page: Page,
  count: number,
  config: Record<string, unknown>,
  log: ActionLogger,
  shouldStop: StopCheck,
  end: number,
  session = new BrowseSession(end, shouldStop),
  budget?: WarmupActivityBudget,
  matchesTopic: TopicMatcher = topicContentMatches,
): Promise<void> {
  if (config.scroll_reels === false) return
  const sleep = session.wait
  session.check()
  const viewMin = Math.max(0, numeric(config.post_view_min_seconds, 2))
  const viewMax = Math.max(viewMin, numeric(config.post_view_max_seconds, 5))
  const seen = new Set<string>()
  let watched = 0
  const target = Math.min(Math.max(0, Math.round(count)), budget?.remaining('reels') ?? Infinity)
  const topics = warmupTopics(config.warmup_topics)
  let inspected = 0
  while (watched < target && inspected++ < target + 15 && Date.now() < end && !shouldStop()) {
    await assertInstagramReady(page)
    const id = reelId(page.url())
    if (id) {
      if (seen.has(id)) {
        // Same reel stuck (advance failed): try Next once, then bail.
        if (!(await advanceReel(page, session).catch(() => false))) break
        continue
      }
      seen.add(id)
    }
    // Sponsored reel: flick past fast, never engage.
    if (await isAdReel(page).catch(() => false)) {
      log({ event: 'automation.actions.reels.skipped_reel_ad', message: 'Skipped reel ad' })
      await sleep(random(400, 900))
      if (Date.now() >= end || shouldStop()) break
      if (!(await advanceReel(page, session).catch(() => false))) {
        log({ event: 'automation.actions.reels.reels_stuck_heading_back', message: 'Reels stuck, heading back' })
        break
      }
      await sleep(random(1200, 2200))
      continue
    }
    const video = await inViewVideo(page)
    if (!video) break
    const context = await video.evaluate(reelPostContext)
    const preserveFollowed = context.relationship !== 'not-followed'
    // Inspect the current author before deciding whether to skip.
    if (!preserveFollowed && chance(config.reels_skip_chance ?? 25)) {
      await sleep(random(300, 800))
      if (Date.now() >= end || shouldStop()) break
      if (!(await advanceReel(page, session).catch(() => false))) {
        log({ event: 'automation.actions.reels.reels_stuck_heading_back', message: 'Reels stuck, heading back' })
        break
      }
      await sleep(random(1200, 2200))
      continue
    }
    // Include caption siblings while stopping before containers with neighboring reels.
    const post = video.locator('xpath=ancestor::*[ancestor::main][count(.//video)=1][last()]')
    const related = !preserveFollowed && topics.length > 0 && await matchesTopic(context, topics, session, log, post)
    if (!feedPostMatches(context, topics, related)) {
      log({ event: 'automation.warmup.reel_off_topic', message: 'Skipped a reel outside the selected topics' })
      await sleep(random(300, 800))
      if (!await advanceReel(page, session)) break
      continue
    }
    if (budget && !budget.take('reels')) break
    // Clip length drives the watch time, same as feed videos.
    let clip = 0
    try {
      const d = await video
        ?.evaluate((v) => (v as HTMLVideoElement).duration)
        .catch(() => NaN)
      if (Number.isFinite(d) && (d as number) > 0) clip = d as number
    } catch {
      // Unknown length: fall back to plain view timing.
    }
    const dwell =
      (clip > 0
        ? Math.min(Math.max(viewMin, clip * random(0.5, 1)), 35)
        : Math.random() > 0.85 ? random(Math.max(viewMin, 18), Math.max(viewMax, 35))
        : random(Math.max(viewMin, 6), Math.max(viewMax, 16))) * 1000
    const viewed = await viewVideo(video, dwell, session)
    if (viewed && budget) budget.browsed++
    if (viewed && numeric(config.warmup_day, 1) >= 8 && budget) {
      await maintainPost(page, post, context, topics, budget, session, log, matchesTopic)
    }
    await assertInstagramReady(page)
    if (Date.now() >= end || shouldStop()) break
    watched++
    if (watched >= target) break
    if (!(await advanceReel(page, session).catch(() => false))) {
      log({ event: 'automation.actions.reels.reels_stuck_heading_back', message: 'Reels stuck, heading back' })
      break
    }
    await sleep(random(1200, 2200))
  }
  log({ event: 'automation.reels_result', watchedCount: watched })
}
