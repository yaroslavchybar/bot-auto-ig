import type { Locator, Page } from 'playwright-core'
import { isTemporaryUiError } from './ui-errors.js'
import { BrowseSession } from './session.js'
import { viewVideo } from './viewing.js'
import type { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { assertInstagramReady } from './instagram-state.js'
import { warmupTopics, feedPostMatches, reelPostContext } from '../../shared/warmupTopics.js'
import { topicContentMatches, type TopicMatcher } from './topic-intent.js'
import { engagePost } from './engagement.js'
import { clickAction } from './action-locator.js'
import { nativeWheelFor, type NativeWheel } from '../../browser/desktopPointer.js'
import { positionScrollCursor } from './mouse.js'
import { publishSessionDecision } from './session-decision.js'
import {
  numeric,
  random,
  type ActionLogger,
  type StopCheck,
} from './shared.js'

const REEL_URL = /\/reels\/([A-Za-z0-9_-]+)\/?/

function reelId(url: string): string {
  return url.match(REEL_URL)?.[1] ?? ''
}

// Reuse an open viewer; otherwise navigate through the sidebar within one opening budget.
export async function openReels(page: Page, log: ActionLogger, session = new BrowseSession()): Promise<boolean> {
  session.check()
  const opening = new BrowseSession(Math.min(session.end, Date.now() + 15_000), () => session.stopped())
  opening.wait = async ms => { await session.wait(opening.timeout(ms)); opening.check() }
  const onReels = () => /\/reels\//.test(page.url())
  let stage = 'sidebar'
  try {
    const alreadyOpen = onReels()
    if (!alreadyOpen) {
      const btn = page.locator('a:has(svg[aria-label="Reels"])').filter({ visible: true }).first()
      if (!await btn.isVisible()) {
        log({ event: 'automation.actions.reels.open_failed', stage, reason: 'Reels button is unavailable' })
        return false
      }
      await clickAction(btn, opening.timeout(5000))
      stage = 'navigation'
      await page.waitForURL(/\/reels\//, { timeout: opening.timeout(10_000) })
    }
    stage = 'settling'
    if (!await waitForSettle(page, opening) || !onReels()) {
      log({ event: 'automation.actions.reels.open_failed', stage, reason: 'Visible reel did not settle' })
      return false
    }
    if (!alreadyOpen) log({ event: 'automation.actions.reels.opened_reels', message: 'Opened reels' })
    return true
  } catch (error) {
    session.check()
    log({ event: 'automation.actions.reels.open_failed', stage, error })
    return false
  }
}

// Live ads use a Facebook ad-redirect CTA. Keep markers inside this video's
// single-reel container because Instagram preloads neighboring ads in the DOM.
export function reelAdMarker(video: Element): 'ad_redirect' | 'ad_label_and_cta' | null {
  const view = video.ownerDocument.defaultView!
  let post = video.parentElement
  if (!post || post.querySelectorAll('video').length !== 1) return null
  while (post.parentElement && !/^(MAIN|BODY|HTML)$/.test(post.parentElement.tagName) &&
    post.parentElement.querySelectorAll('video').length === 1) post = post.parentElement
  let tag = false, cta = false
  for (const el of post.querySelectorAll<HTMLElement>('span, div, a, button, [role="button"]')) {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height || r.bottom <= 0 || r.top >= view.innerHeight ||
      r.right <= 0 || r.left >= view.innerWidth) continue
    const style = view.getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none') continue
    if (el.tagName === 'A') {
      try {
        const url = new URL(el.getAttribute('href') ?? '', video.ownerDocument.baseURI)
        if ((url.hostname === 'www.facebook.com' || url.hostname === 'facebook.com') &&
          url.pathname === '/ads/ig_redirect/') return 'ad_redirect'
      } catch { /* An invalid link is not an ad marker. */ }
    }
    const text = (el.innerText || '').trim()
    if (!text || text.length > 24) continue
    if (/^(ad|sponsored)$/i.test(text)) tag = true
    if (/^(listen now|learn more|shop now|install now|sign up|book now|order now|download|play now|get showtimes)$/i.test(text)) cta = true
  }
  return tag && cta ? 'ad_label_and_cta' : null
}
// Video filling the screen right now (current + preloaded share the DOM).
async function inViewVideo(page: Page, session: BrowseSession): Promise<Locator | null> {
  try {
    const vids = page.locator('video')
    const n = await vids.count().catch(() => 0)
    const viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    let best: Locator | null = null, bestArea = 0
    for (let i = 0; i < n; i++) {
      const box = await vids.nth(i).boundingBox({ timeout: session.timeout(1000) }).catch(() => null)
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

// Instagram can offset media within a reel. Wait for a visible, stable frame, not viewport centering.
async function waitForSettle(page: Page, session: BrowseSession): Promise<boolean> {
  const sleep = session.wait
  session.check()
  let previous: { x: number; y: number; width: number; height: number } | undefined
  for (let i = 0; i < 50; i++) {
    const video = await inViewVideo(page, session)
    const box = await video?.boundingBox({ timeout: session.timeout(1000) })
    const port = await video?.evaluate(reelViewBounds, undefined, { timeout: session.timeout(1000) })
    if (box && port && port.bottom > port.top) {
      const height = port.bottom - port.top
      const visible = Math.max(0, Math.min(box.y + box.height, port.bottom) - Math.max(box.y, port.top))
      if (visible >= Math.min(box.height, height) * 0.9) {
        if (previous && Math.abs(box.y - previous.y) <= 1 && Math.abs(box.x - previous.x) <= 1 &&
          Math.abs(box.width - previous.width) <= 1 && Math.abs(box.height - previous.height) <= 1) return true
        previous = { ...box }
      } else previous = undefined
    } else previous = undefined
    await sleep(100)
  }
  return false
}

// Headed sessions use one native wheel notch. Other viewers retain the named Next control.
export async function advanceReel(page: Page, session: BrowseSession, log: ActionLogger = () => {},
  wheel: NativeWheel | undefined = nativeWheelFor(page)): Promise<boolean> {
  session.check()
  publishSessionDecision(page, null)
  const before = reelId(page.url())
  const changed = () => { const id = reelId(page.url()); return !!id && id !== before }
  let stage = 'next_button'
  const failed = (reason: string, error?: unknown) => {
    session.check()
    log({ event: 'automation.actions.reels.advance_failed', inputMethod: wheel ? 'native_wheel' : 'next_button', stage, reason, error })
    return false
  }
  try {
    if (wheel) {
      stage = 'wheel_target'
      const video = await inViewVideo(page, session)
      const box = await video?.boundingBox({ timeout: session.timeout(1000) })
      const port = await video?.evaluate(reelViewBounds, undefined, { timeout: session.timeout(1000) })
      const viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      if (!box || !port) return failed('Visible reel is unavailable')
      const left = Math.max(0, box.x), right = Math.min(viewport.width, box.x + box.width)
      const top = Math.max(port.top, box.y), bottom = Math.min(port.bottom, box.y + box.height)
      if (right <= left || bottom <= top) return failed('Visible reel has no wheel target')
      stage = 'cursor'
      const { x, y } = await positionScrollCursor(page, { left, right, top, bottom }, session)
      session.check()
      stage = 'wheel'
      await wheel(x, y, 'down', session.timeout(5000))
    } else {
      const next = page.getByRole('button', { name: 'Navigate to next Reel', exact: true }).filter({ visible: true }).first()
      if (!await next.isVisible() || !await next.isEnabled()) return failed('Next button is unavailable')
      stage = 'click'
      await clickAction(next, session.timeout(5000))
    }
    stage = 'navigation'
    await page.waitForURL(url => !!reelId(url.href) && reelId(url.href) !== before, { timeout: session.timeout(5000) })
    stage = 'settling'
    if (await waitForSettle(page, session) && changed()) return true
    return failed('Next reel did not settle')
  } catch (error) {
    return failed('Reel advancement failed', error)
  }
}

// Browse until the session deadline; a finite count is only used by bounded callers.
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
  seen = new Set<string>(),
): Promise<void> {
  if (config.scroll_reels === false) return
  session.check()
  const viewMin = Math.max(0, numeric(config.post_view_min_seconds, 2))
  const viewMax = Math.max(viewMin, numeric(config.post_view_max_seconds, 5))
  let watched = 0
  const target = Math.max(0, Math.round(count))
  const topics = warmupTopics(config.warmup_topics)
  const advance = async () => {
    const moved = await advanceReel(page, session, log)
    // Skipping an ad or off-topic reel is still real browsing progress.
    if (moved && budget) budget.browsed++
    return moved
  }
  let inspected = 0
  while (watched < target && inspected++ < target + 15 && Date.now() < end && !shouldStop()) {
    await assertInstagramReady(page)
    const id = reelId(page.url())
    if (id) {
      if (seen.has(id)) {
        // Same reel stuck (advance failed): try Next once, then bail.
        if (!await advance()) break
        continue
      }
      seen.add(id)
    }
    const video = await inViewVideo(page, session)
    if (!video) break
    let context: ReturnType<typeof reelPostContext>
    try {
      const adMarker = await video.evaluate(reelAdMarker, undefined, { timeout: session.timeout(1000) })
      // Sponsored reel: advance before classification or engagement.
      if (adMarker) {
        log({ event: 'automation.actions.reels.skipped_reel_ad', message: 'Skipped reel ad', adMarker })
        if (Date.now() >= end || shouldStop()) break
        if (!await advance()) {
          log({ event: 'automation.actions.reels.reels_stuck_heading_back', message: 'Reels stuck, heading back' })
          break
        }
        continue
      }
      context = await video.evaluate(reelPostContext)
    }
    catch (error) {
      session.check()
      if (!isTemporaryUiError(error)) throw error
      await assertInstagramReady(page, session)
      log({ event: 'automation.actions.reels.context_unavailable', error })
      if (!await advance()) break
      continue
    }
    // Include caption siblings while stopping before containers with neighboring reels.
    const post = video.locator('xpath=ancestor::*[ancestor::main][count(.//video)=1][last()]')
    const related = topics.length > 0 && await matchesTopic(context, topics, session, log, post)
    if (!feedPostMatches(context, topics, related)) {
      log({ event: 'automation.warmup.reel_off_topic', message: 'Skipped a reel outside the selected topics' })
      await session.wait(random(500, 1200))
      if (!await advance()) break
      continue
    }
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
    if (viewed && budget) { budget.browsed++; budget.used.reels++ }
    if (viewed && numeric(config.warmup_day, 1) >= 2 && budget) {
      const surface = video.locator('xpath=ancestor::*[@role="group" and @aria-label="Video player"][1]')
      await engagePost(page, post, context, topics, budget, session, log, matchesTopic, surface)
    }
    if (viewed) watched++
    await assertInstagramReady(page)
    if (Date.now() >= end || shouldStop()) break
    if (watched >= target) break
    if (!await advance()) {
      log({ event: 'automation.actions.reels.reels_stuck_heading_back', message: 'Reels stuck, heading back' })
      break
    }
  }
  log({ event: 'automation.reels_result', watchedCount: watched })
}
