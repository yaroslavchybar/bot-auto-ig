import type { Page } from 'playwright-core'
import { actionLocator } from './action-locator.js'
import { BrowseSession } from './session.js'
import { random, type ActionLogger } from './shared.js'

/** Check Instagram's warnings, never captions or comments with similar wording. */
export async function assertInstagramReady(page: Page): Promise<void> {
  if (/^\/(?:challenge|checkpoint|accounts\/(?:login|suspended|disabled))(?:\/|$)/.test(new URL(page.url()).pathname))
    throw new Error('Instagram login or checkpoint needs attention')
  const warning = await page.locator('[role="dialog"], [role="alertdialog"], [role="alert"]')
    .filter({ visible: true }).evaluateAll(boxes => {
      for (const box of boxes) {
        if (box.querySelector('article, video, svg[aria-label="Like"]')) continue
        const text = (box as HTMLElement).innerText
        if (/your account (?:has been|was) suspended|confirm it.s you|help us confirm|unusual activity/i.test(text)) return 'checkpoint'
        if (/try again later|we limit how often|action blocked/i.test(text)) return 'limit'
      }
      return null
    })
  if (warning) throw new Error(`Instagram ${warning} needs attention`)
}

/** Brief notification check; no follows, replies, or notification-row clicks. */
export async function checkNotifications(page: Page, log: ActionLogger, session: BrowseSession): Promise<boolean> {
  session.check()
  const link = page.getByRole('link', { name: 'Notifications', exact: true })
  if (!await link.isVisible()) return false
  await (await actionLocator(link, session.timeout(5_000))).click({ timeout: session.timeout(5_000) })
  const heading = page.getByRole('heading', { name: 'Notifications', exact: true })
  try {
    await heading.waitFor({ state: 'visible', timeout: session.timeout(10_000) })
    await assertInstagramReady(page)
    await session.wait(random(2500, 5000))
    log({ event: 'automation.warmup.notifications_checked', message: 'Checked notifications' })
    return true
  } finally {
    // A DM composer may also have Close; stay within the notification panel.
    const panel = heading.locator('xpath=ancestor::*[.//*[self::button or @role="button"][@aria-label="Close" or .//*[@aria-label="Close"] or normalize-space(.)="Close"]][1]')
    const close = panel.getByRole('button', { name: 'Close', exact: true }).filter({ visible: true }).first()
    if (!session.stopped() && await close.isVisible())
      await (await actionLocator(close, session.timeout(3_000))).click({ timeout: session.timeout(3_000) })
    else await page.keyboard.press('Escape').catch(() => {})
  }
}
