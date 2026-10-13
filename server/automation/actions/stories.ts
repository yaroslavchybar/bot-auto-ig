import type { Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { focusPageContent } from '../../browser/focus.js'
import { randomDelay, type ActionLogger, type StopCheck } from './shared.js'
import { clickVisible } from './mouse.js'
import { dismissPopups, isInstagramHome } from './navigation.js'
import { BrowseSession, SessionEnded } from './session.js'
import { actionLocator } from './action-locator.js'

export async function watchStories(
  page: Page,
  maxStories: number,
  log: ActionLogger,
  shouldStop: StopCheck,
  timing: { minSeconds: number; maxSeconds: number; deadline?: number } = { minSeconds: 2, maxSeconds: 5 },
): Promise<number> {
  const session = new BrowseSession(timing.deadline ?? Infinity, shouldStop)
  let watched = 0, opened = false
  try {
    session.check()
    if (!isInstagramHome(page)) await page.goto('https://www.instagram.com/', {
      waitUntil: 'domcontentloaded', timeout: session.timeout(45_000),
    })
    await focusPageContent(page)
    await dismissPopups(page, new BrowseSession(Math.min(session.end, Date.now() + 15_000), shouldStop))
    // Current trays use named buttons; older layouts used story links.
    const story = page.locator('main [role="button"][aria-label^="Story by "]:visible, main a[href*="/stories/"]:visible').first()
    const opening = new BrowseSession(Math.min(Date.now() + 15_000, session.end), shouldStop)
    try {
      await story.waitFor({ state: 'visible', timeout: opening.timeout(15_000) })
      opening.check()
    } catch (error) {
      if (error instanceof SessionEnded) return 0
      if (!(error instanceof errors.TimeoutError)) throw error
    }
    if (!(await story.isVisible().catch(() => false))) {
      log({ event: 'automation.actions.stories.stories_story_tray_found', message: 'Stories: no story tray found' })
      return 0
    }
    opened = true
    await (await actionLocator(story, opening.timeout(5_000))).click({ timeout: opening.timeout(5_000) })
    while (watched < Math.max(0, maxStories) && !shouldStop()) {
      const remaining = Math.max(0, (session.end - Date.now()) / 1000)
      if (remaining <= 0) break
      await randomDelay(
        Math.min(remaining, Math.max(0, timing.minSeconds)),
        Math.min(remaining, Math.max(0, timing.minSeconds, timing.maxSeconds)),
      )
      if (shouldStop()) break
      watched++
      if (watched < maxStories && !shouldStop())
        await clickVisible(page, '[aria-label*="Next"], button:has-text("Next")', session)
    }
  } catch (error) {
    // Optional stories own their deadline; chunk expiry must not finish warm-up.
    if (!(error instanceof SessionEnded) && !(error instanceof errors.TimeoutError && session.stopped())) throw error
  } finally {
    if (opened) await page.keyboard.press('Escape').catch(() => undefined)
  }
  log({ event: 'automation.stories_result', watchedCount: watched })
  return watched
}
