import type { Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { clickAction } from './action-locator.js'
import { isTransientDomIssue } from '../../shared/domErrors.js'
import { isTemporaryUiError } from './ui-errors.js'
import { BrowseSession } from './session.js'
import { random, type ActionLogger } from './shared.js'
import { dismissMetaAccountPopup } from './navigation.js'
import { withUiDiagnosticContext } from './ui-diagnostics.js'

/** Check Instagram's warnings, never captions or comments with similar wording. */
export async function assertInstagramReady(page: Page, session?: BrowseSession): Promise<void> {
  if (
    /^\/(?:challenge|checkpoint|accounts\/(?:login|suspended|disabled))(?:\/|$)/.test(
      new URL(page.url()).pathname,
    )
  )
    throw new Error('Instagram login or checkpoint needs attention')
  const warning = await page
    .locator('[role="dialog"], [role="alertdialog"], [role="alert"]')
    .filter({ visible: true })
    .evaluateAll((boxes) => {
      let metaAccount = false
      for (const box of boxes) {
        if (box.querySelector('article, video, svg[aria-label="Like"]')) continue
        const text = (box as HTMLElement).innerText
        if (
          /your account (?:has been|was) suspended|confirm it.s you|help us confirm|unusual activity/i.test(
            text,
          )
        )
          return 'checkpoint'
        if (/try again later|we limit how often|action blocked/i.test(text)) return 'limit'
        if (text.includes('Your updated account works across Meta apps and devices') &&
          [...box.querySelectorAll('*')].some(node => node.textContent?.trim() === 'Your Meta Account is here'))
          metaAccount = true
      }
      return metaAccount ? 'meta_account' : null
    })
  if (warning === 'meta_account') {
    if (!await dismissMetaAccountPopup(page, session))
      throw new Error('Instagram Meta account popup needs attention')
    return
  }
  if (warning) throw new Error(`Instagram ${warning} needs attention`)
}

export const notificationsHeading = (page: Page) =>
  page
    .getByRole('heading', { name: 'Notifications', exact: true })
    .filter({ visible: true })
    .first()

const notificationControls = (page: Page) => page.locator(
  'a:has(svg[aria-label="Notifications"]), [role="button"]:has(svg[aria-label="Notifications"])',
).filter({ visible: true })

/** The unread dot has no accessible label; Instagram colors it with --ig-badge. */
export async function hasUnreadNotifications(page: Page): Promise<boolean> {
  return notificationControls(page).evaluateAll(controls => controls.some(control => {
    const view = control.ownerDocument.defaultView!
    const color = view.getComputedStyle(control).getPropertyValue('--ig-badge').trim() || '255, 48, 64'
    const badgeColor = `rgb(${color})`.replace(/\s/g, '')
    return [...control.querySelectorAll('div, span')].some(node => {
      const rect = node.getBoundingClientRect(), style = view.getComputedStyle(node)
      return rect.width > 0 && rect.width <= 32 && rect.height > 0 && rect.height <= 24 &&
        rect.bottom > 0 && rect.top < view.innerHeight && rect.right > 0 && rect.left < view.innerWidth &&
        style.visibility === 'visible' && style.display !== 'none' && style.opacity !== '0' &&
        style.backgroundColor.replace(/\s/g, '') === badgeColor
    })
  }))
}

/** Icon labels stay stable when Instagram expands the sidebar and duplicates its link names. */
export async function openNotifications(
  page: Page,
  session = new BrowseSession(),
): Promise<boolean> {
  const heading = notificationsHeading(page)
  const deadline = Math.min(session.end, Date.now() + 15_000)
  const timeout = (max: number) =>
    Math.min(session.timeout(max), Math.max(1, deadline - Date.now()))
  for (let attempt = 0; attempt < 2 && Date.now() < deadline; attempt++) {
    session.check()
    if (await heading.isVisible()) return true
    const link = notificationControls(page).first()
    if (!(await link.isVisible())) return false
    try {
      const controls = page.locator('a:has(svg[aria-label="Home"])')
        .locator('xpath=ancestor::*[.//svg[@aria-label="Search"]][1]')
      const humanOptions = { human_config: { scroll_target_zone: [0, 1], mouse_overshoot_chance: 0 } }
      await withUiDiagnosticContext({ action: 'notifications', stage: 'open_notifications', session, controls }, async () => {
        // Hover expands/remounts the sidebar. Re-resolve this semantic control after movement;
        // pinning its old DOM node would keep waiting for a control Instagram has replaced.
        await link.hover({ ...humanOptions, timeout: timeout(5_000) })
        session.check()
        if (await heading.isVisible()) return
        await notificationControls(page).first().click({ ...humanOptions, timeout: timeout(5_000) })
        await heading.waitFor({ state: 'visible', timeout: timeout(10_000) })
      })
      return true
    } catch (error) {
      session.check()
      await assertInstagramReady(page)
      if (!isTransientDomIssue(error) && !(error instanceof errors.TimeoutError)) throw error
      // A click may have opened the panel before the old sidebar element disappeared.
      if (await heading.isVisible()) return true
    }
  }
  return false
}

/** The notification panel has no dialog role; locate its Close from its own heading. */
export async function closeNotifications(page: Page, session = new BrowseSession()): Promise<void> {
  const heading = notificationsHeading(page)
  if (session.stopped() || !(await heading.isVisible())) return
  const returnUrl = page.url()
  const panel = heading.locator(
    'xpath=ancestor::*[.//*[self::button or @role="button"][@aria-label="Close" or .//*[@aria-label="Close"] or normalize-space(.)="Close"]][1]',
  )
  const close = panel
    .getByRole('button', { name: 'Close', exact: true })
    .filter({ visible: true })
    .first()
  try {
    if (await close.isVisible()) await clickAction(close, session.timeout(3_000))
    else await page.keyboard.press('Escape')
    await heading.waitFor({ state: 'hidden', timeout: session.timeout(3_000) })
  } catch (error) {
    session.check()
    if (!isTransientDomIssue(error) && !(error instanceof errors.TimeoutError)) throw error
    if (!(await heading.isVisible())) return
    try {
      await page.keyboard.press('Escape')
      await heading.waitFor({ state: 'hidden', timeout: session.timeout(3_000) })
    } catch (retryError) {
      session.check()
      if (!isTemporaryUiError(retryError)) throw retryError
      await assertInstagramReady(page, session)
      // A panel that survives Escape must be cleared before browsing underneath it.
      await page.goto(returnUrl, { waitUntil: 'domcontentloaded', timeout: session.timeout(15_000) })
      await heading.waitFor({ state: 'hidden', timeout: session.timeout(3_000) })
    }
  }
}

/** Brief notification check; no follows, replies, or notification-row clicks. */
export async function checkNotifications(
  page: Page,
  log: ActionLogger,
  session: BrowseSession,
): Promise<boolean> {
  session.check()
  try {
    if (!(await openNotifications(page, session))) return false
    try {
      await assertInstagramReady(page)
      await session.wait(random(2500, 5000))
      log({ event: 'automation.warmup.notifications_checked', message: 'Checked notifications' })
    } finally {
      await closeNotifications(page, session)
    }
    return true
  } catch (error) {
    session.check()
    if (!isTemporaryUiError(error)) throw error
    await assertInstagramReady(page, session)
    log({ event: 'automation.warmup.notifications_skipped', error })
    return false
  }
}
