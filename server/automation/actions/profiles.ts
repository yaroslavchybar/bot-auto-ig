import type { Locator, Page } from 'playwright-core'
import { BrowseSession, SessionEnded } from './session.js'
import { random, type ActionLogger } from './shared.js'
import { isUserHref, PROFILE_URL } from './guards.js'
import { revealForClick } from './scroll.js'
import { assertInstagramReady } from './instagram-state.js'
import { clickAction } from './action-locator.js'

// First user link in the post is the author (avatar/username row).
export async function openAuthorProfile(page: Page, target: Locator, session = new BrowseSession()): Promise<boolean> {
  const sleep = session.wait
  session.check()
  try {
    const link = target.locator('a[href^="/"]').first()
    if (!isUserHref(await link.getAttribute('href').catch(() => null)))
      return false
    // Author row below the fold: glide it into view, then tap it.
    await revealForClick(page, link, session).catch(() => false)
    if (!(await link.isVisible().catch(() => false))) return false
    await clickAction(link, session.timeout(5_000))
    await sleep(random(1200, 2500))
    return PROFILE_URL.test(page.url())
  } catch {
    return false
  }
}

// Own profile via the sidebar avatar button. UI only, no direct navigation.
export async function openOwnProfile(page: Page, log: ActionLogger, session = new BrowseSession()): Promise<boolean> {
  const sleep = session.wait
  session.check()
  try {
    // Sidebar avatar has an aria-selected wrapper; feed avatars do not.
    const own = page.locator('a[href^="/"]:has([aria-selected] img[alt$="profile picture"])').first()
    // Done/share actions reload the page: wait out the reload instead of one glance.
    await own.waitFor({ state: 'visible', timeout: session.timeout(20_000) }).catch(() => undefined)
    if (!(await own.isVisible().catch(() => false))) return false
    await clickAction(own, session.timeout(5_000))
    await page.waitForURL(PROFILE_URL, { timeout: session.timeout(10_000) }).catch(() => undefined)
    await sleep(random(1200, 2500))
    if (!PROFILE_URL.test(page.url())) return false
    log({ event: 'automation.actions.profiles.checking_own_profile', message: 'Checking own profile' })
    return true
  } catch {
    return false
  }
}

/** A brief visit to the matched author, returning to the exact content route. */
export async function visitAuthorProfile(page: Page, target: Locator, log: ActionLogger,
  parent: BrowseSession): Promise<void> {
  const session = new BrowseSession(Math.min(parent.end, Date.now() + 15_000), () => parent.stopped())
  const previous = page.url()
  let opened = false
  try {
    opened = await openAuthorProfile(page, target, session)
    if (!opened) return
    await assertInstagramReady(page, session)
    await page.locator('main header').waitFor({ state: 'visible', timeout: session.timeout(5000) })
    await session.wait(random(2000, 4000))
    log({ event: 'automation.engagement.profile_visited' })
  } catch (error) {
    if (!(error instanceof SessionEnded) || parent.stopped()) throw error
    log({ event: 'automation.engagement.profile_skipped', reason: 'visit_time_used' })
  } finally {
    if (page.url() !== previous && PROFILE_URL.test(page.url()) && !parent.stopped()) {
      await page.keyboard.press('Alt+ArrowLeft')
      await page.waitForURL(previous, { timeout: parent.timeout(5000) })
      await assertInstagramReady(page, parent)
    }
  }
}
