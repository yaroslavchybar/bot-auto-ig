import type { Page } from 'playwright-core'
import { clickLiveAction } from './action-locator.js'
import { isUserHref } from './guards.js'
import { assertInstagramReady } from './instagram-state.js'
import { BrowseSession, SessionEnded } from './session.js'
import type { ActionLogger } from './shared.js'
import { isTemporaryUiError } from './ui-errors.js'

export type PauseDestination = 'profile' | 'dms'
const dependencies = { click: clickLiveAction, check: assertInstagramReady }

/** Click a sidebar destination within the existing pause; the caller waits out the remaining time. */
export async function visitOutreachPausePage(page: Page, destination: PauseDestination, until: number,
  parent: BrowseSession, log: ActionLogger, deps = dependencies): Promise<void> {
  parent.check()
  const session = new BrowseSession(Math.min(until, parent.end), () => parent.stopped())
  if (session.end - Date.now() < 5000) return
  try {
    await deps.check(page, session)
    const link = page.locator(destination === 'profile'
      ? 'a[href^="/"]:has([aria-selected] img[alt$="profile picture"])'
      : 'a[href="/direct/inbox/"]:has(svg[aria-label="Messages"])').filter({ visible: true }).first()
    if (!await link.isVisible()) return
    const href = await link.getAttribute('href', { timeout: session.timeout(1000) })
    if (!href || (destination === 'profile' ? !isUserHref(href) : href !== '/direct/inbox/')) return
    const url = new URL(href, page.url()).href
    await deps.click(page, link, session)
    await page.waitForURL(url, { waitUntil: 'domcontentloaded', timeout: session.timeout(5000) })
    await deps.check(page, session)
    log({ event: 'automation.routine.pause_visit', destination, outcome: 'opened' })
  } catch (error) {
    parent.check()
    await deps.check(page, parent)
    if (!(error instanceof SessionEnded) && !isTemporaryUiError(error)) throw error
    log({ event: 'automation.routine.pause_visit', destination, outcome: 'skipped', error })
  }
}
