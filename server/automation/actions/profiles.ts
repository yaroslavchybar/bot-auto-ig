import type { Locator, Page } from 'playwright-core'
import { BrowseSession, SessionEnded } from './session.js'
import { random, type ActionLogger } from './shared.js'
import { isUserHref, PROFILE_URL } from './guards.js'
import { revealForClick } from './scroll.js'
import { assertInstagramReady } from './instagram-state.js'
import { clickAction, clickLiveAction } from './action-locator.js'
import { mouseBackFor, type NativeBack } from '../../browser/desktopPointer.js'
import { isTemporaryUiError } from './ui-errors.js'
import { watchProfileReels, type ProfileReelEngagement } from './profile-reels.js'

const AUTHOR_PROFILE_URL = /instagram\.com\/[A-Za-z0-9._]+\/(?:reels\/)?$/

// First user link in the post is the author (avatar/username row).
export async function openAuthorProfile(page: Page, target: Locator, session = new BrowseSession()): Promise<boolean> {
  const sleep = session.wait
  session.check()
  try {
    const link = target.locator('a[href^="/"]').first()
    const href = await link.getAttribute('href').catch(() => null)
    if (!isUserHref(href?.replace(/\/reels\/$/, '/') ?? null))
      return false
    // Author row below the fold: glide it into view, then tap it.
    await revealForClick(page, link, session).catch(() => false)
    if (!(await link.isVisible().catch(() => false))) return false
    await clickLiveAction(page, link, session)
    await sleep(random(1200, 2500))
    return PROFILE_URL.test(page.url()) || AUTHOR_PROFILE_URL.test(page.url())
  } catch (error) {
    session.check()
    await assertInstagramReady(page, session)
    if (!isTemporaryUiError(error)) throw error
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
  parent: BrowseSession, back: NativeBack = mouseBackFor(page), engage?: ProfileReelEngagement): Promise<void> {
  const session = new BrowseSession(Math.min(parent.end - 7500, Date.now() + 120_000), () => parent.stopped())
  session.wait = async ms => { await parent.wait(session.timeout(ms)); session.check() }
  const previous = page.url()
  let opened = false, enteredProfile = '', switchedTab = false
  try {
    opened = await openAuthorProfile(page, target, session)
    if (!opened) return
    enteredProfile = page.url()
    await assertInstagramReady(page, session)
    await page.locator('main header').waitFor({ state: 'visible', timeout: session.timeout(5000) })
    await session.wait(random(2000, 4000))
    if (!new URL(enteredProfile).pathname.endsWith('/reels/')) {
      const href = `${new URL(enteredProfile).pathname.replace(/\/$/, '')}/reels/`
      const tab = page.locator(`main a[href="${href}"]`).first()
      if (await tab.isVisible()) {
        await clickLiveAction(page, tab, session)
        switchedTab = true
        await page.waitForURL(new URL(href, enteredProfile).href, { waitUntil: 'commit', timeout: session.timeout(5000) })
      }
    }
    const result = await watchProfileReels(page, session, parent, log, engage)
    log({ event: 'automation.engagement.profile_visited', ...result })
  } catch (error) {
    if (!(error instanceof SessionEnded) || parent.stopped()) throw error
    log({ event: 'automation.engagement.profile_skipped', reason: 'visit_time_used' })
  } finally {
    if (page.url() !== previous && (PROFILE_URL.test(page.url()) || AUTHOR_PROFILE_URL.test(page.url())) && !parent.stopped()) {
      if (switchedTab) {
        await back(parent.timeout(5000))
        await page.waitForURL(enteredProfile, { waitUntil: 'commit', timeout: parent.timeout(5000) })
      }
      await back(parent.timeout(5000))
      await page.waitForURL(previous, { waitUntil: 'commit', timeout: parent.timeout(5000) })
      await assertInstagramReady(page, parent)
    }
  }
}
