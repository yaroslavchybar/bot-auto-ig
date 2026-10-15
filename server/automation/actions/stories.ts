import type { Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { isTemporaryUiError } from './ui-errors.js'
import { focusPageContent } from '../../browser/focus.js'
import { random, randomDelay, type ActionLogger, type StopCheck } from './shared.js'
import { clickVisible } from './mouse.js'
import { dismissPopups, isInstagramHome } from './navigation.js'
import { BrowseSession, SessionEnded } from './session.js'
import { actionLocator } from './action-locator.js'
import { assertInstagramReady } from './instagram-state.js'

export const UNSEEN_STORY_SELECTOR = 'main [role="button"][aria-label^="Story by "][aria-label$=", not seen"]:not([aria-disabled="true"])'

/** Capture the initial tray before startup checks or Explore navigate away. */
export async function hasUnseenStories(page: Page, session: BrowseSession): Promise<boolean> {
  session.check()
  try {
    await page.locator(`${UNSEEN_STORY_SELECTOR}:visible`).first().waitFor({
      state: 'visible', timeout: session.timeout(2000),
    })
    session.check()
    return true
  } catch (error) {
    session.check()
    if (!(error instanceof errors.TimeoutError)) throw error
    return false
  }
}

const storyPath = (page: Page) => {
  const path = new URL(page.url()).pathname
  const owner = /^\/stories\/([\w.]+)\//.exec(path)?.[1]
  return owner ? { path, owner: owner.toLowerCase() } : null
}

export async function watchStories(
  page: Page,
  maxStories: number,
  log: ActionLogger,
  shouldStop: StopCheck,
  timing: { minSeconds: number; maxSeconds: number; deadline?: number } = { minSeconds: 2, maxSeconds: 5 },
): Promise<number> {
  const session = new BrowseSession(timing.deadline ?? Infinity, shouldStop)
  const unlimited = maxStories === Infinity
  if (unlimited && !Number.isFinite(session.end)) throw new Error('Watching all stories requires a deadline')
  let watched = 0, opened = false
  try {
    session.check()
    if (!isInstagramHome(page)) await page.goto('https://www.instagram.com/', {
      waitUntil: 'domcontentloaded', timeout: session.timeout(45_000),
    })
    await focusPageContent(page)
    await dismissPopups(page, new BrowseSession(Math.min(session.end, Date.now() + 15_000), shouldStop))
    const unseen = page.locator(UNSEEN_STORY_SELECTOR)
    const story = page.locator(`${UNSEEN_STORY_SELECTOR}:visible`).first()
    const opening = new BrowseSession(Math.min(Date.now() + 15_000, session.end), shouldStop)
    try {
      await story.waitFor({ state: 'visible', timeout: opening.timeout(2000) })
      opening.check()
    } catch (error) {
      if (!(error instanceof SessionEnded) && !(error instanceof errors.TimeoutError)) throw error
      log({ event: 'automation.actions.stories.no_unseen_stories', outcome: 'skipped' })
      return 0
    }
    if (!(await story.isVisible().catch(() => false))) {
      log({ event: 'automation.actions.stories.no_unseen_stories', outcome: 'skipped' })
      return 0
    }
    opening.check()
    const owners = maxStories > 0 ? new Set(await unseen.evaluateAll(nodes => nodes.flatMap(node => {
      const owner = /^Story by ([\w.]+), not seen$/.exec(node.getAttribute('aria-label') ?? '')?.[1]
      return owner ? [owner.toLowerCase()] : []
    }))) : new Set<string>()
    opened = true
    await (await actionLocator(story, opening.timeout(5_000))).click({ timeout: opening.timeout(5_000) })
    if (unlimited) await page.waitForURL(url => /^\/stories\/[\w.]+\//.test(url.pathname), { timeout: session.timeout(5000) })
    const seen = new Set<string>()
    while (watched < Math.max(0, maxStories) && !shouldStop()) {
      await assertInstagramReady(page, session)
      const current = storyPath(page)
      if (!current || !owners.has(current.owner) || seen.has(current.path)) break
      const remaining = Math.max(0, (session.end - Date.now()) / 1000)
      if (remaining <= 0) break
      const min = Math.min(remaining, Math.max(0, timing.minSeconds))
      const max = Math.min(remaining, Math.max(0, timing.minSeconds, timing.maxSeconds))
      if (unlimited) await session.wait(random(min, max) * 1000)
      else await randomDelay(min, max)
      if (shouldStop()) break
      watched++
      seen.add(current.path)
      if (watched >= maxStories) break
      await assertInstagramReady(page, session)
      const next = storyPath(page)
      if (!next || !owners.has(next.owner)) break
      // Autoplay already advanced: watch the new clip rather than pressing Next again.
      if (next.path !== current.path) continue
      if (!await clickVisible(page, 'button:has(svg[aria-label="Next"]), [role="button"]:has(svg[aria-label="Next"])', session)) break
      if (unlimited) await page.waitForURL(url => url.pathname !== current.path, { timeout: session.timeout(3000) })
    }
  } catch (error) {
    // Optional stories own their deadline; chunk expiry must not finish warm-up.
    if (!(error instanceof SessionEnded) && !session.stopped()) {
      if (!isTemporaryUiError(error)) throw error
      await assertInstagramReady(page, session)
      log({ event: 'automation.actions.stories.skipped', error })
    }
  } finally {
    if (opened) await page.keyboard.press('Escape').catch(() => undefined)
  }
  log({ event: 'automation.stories_result', watchedCount: watched })
  return watched
}
