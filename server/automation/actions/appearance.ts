import type { Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { clickLiveAction } from './action-locator.js'
import { assertInstagramReady } from './instagram-state.js'
import { BrowseSession, SessionEnded } from './session.js'
import type { ActionLogger } from './shared.js'
import { isTemporaryUiError } from './ui-errors.js'

export type InstagramTheme = 'light' | 'dark'

/** Country-default IANA timezones include daylight-saving changes; never use the server's local clock. */
export function sessionTheme(timezone: string | undefined, now = Date.now()): InstagramTheme | undefined {
  if (!timezone) return undefined
  try {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(now))
    return hour >= 7 && hour < 19 ? 'light' : 'dark'
  } catch { return undefined }
}

const dependencies = { click: clickLiveAction, check: assertInstagramReady, now: Date.now }

/** Set Instagram's saved appearance once at browsing startup, through its normal More menu. */
export async function setSessionAppearance(page: Page, timezone: string | undefined, parent: BrowseSession,
  log: ActionLogger, deps = dependencies): Promise<void> {
  parent.check()
  const theme = sessionTheme(timezone, deps.now())
  if (!theme) { log({ event: 'automation.session.appearance', outcome: 'skipped', reason: 'proxy_timezone_unknown' }); return }
  const root = page.locator(`html.__fb-${theme}-mode`)
  if (await root.isVisible()) { log({ event: 'automation.session.appearance', theme, timezone, outcome: 'unchanged' }); return }
  // Several humanized cursor moves must finish before the switch can be clicked.
  const setting = new BrowseSession(Math.min(parent.end, deps.now() + 30_000), () => parent.stopped())
  const menu = page.locator('a:has(svg[aria-label="Settings"])').filter({ visible: true }).first()
  const moreMenu = page.getByRole('dialog').filter({ visible: true }).last()
  const panel = page.getByRole('dialog').filter({ hasText: 'Switch appearance', visible: true }).last()
  let opened = false
  try {
    // Leave an existing viewer or account prompt to its owning action.
    if (await page.getByRole('dialog').filter({ visible: true }).count()) {
      log({ event: 'automation.session.appearance', theme, timezone, outcome: 'skipped', reason: 'existing_dialog' })
      return
    }
    try {
      await deps.check(page, setting)
      await menu.waitFor({ state: 'visible', timeout: setting.timeout(3000) })
      opened = true
      await deps.click(page, menu, setting, 10_000)
      await deps.click(page, panel.getByRole('button', { name: /Switch appearance$/ }).first(), setting, 10_000)
      const toggle = panel.getByRole('switch')
      await toggle.waitFor({ state: 'visible', timeout: setting.timeout(3000) })
      const checked = await toggle.getAttribute('aria-checked')
      if (checked !== 'true' && checked !== 'false') throw new errors.TimeoutError('Appearance switch state is unavailable')
      if ((checked === 'true') !== (theme === 'dark')) {
        // Use the row; clicking its nested input did not reliably change the saved appearance.
        await deps.click(page, panel.getByRole('button', { name: 'Dark mode', exact: true }), setting, 10_000)
      }
      await root.waitFor({ state: 'visible', timeout: setting.timeout(2000) })
    } finally {
      if (opened && !parent.stopped() && await moreMenu.isVisible()) {
        await deps.click(page, menu, parent, 10_000)
        await moreMenu.waitFor({ state: 'hidden', timeout: parent.timeout(2000) })
      }
    }
    log({ event: 'automation.session.appearance', theme, timezone, outcome: 'switched' })
  } catch (error) {
    parent.check()
    await deps.check(page, parent)
    if (!(error instanceof SessionEnded) && !isTemporaryUiError(error)) throw error
    log({ event: 'automation.session.appearance', theme, timezone, outcome: 'skipped', error })
  }
}
