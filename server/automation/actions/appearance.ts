import type { Locator, Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { clickLiveAction } from './action-locator.js'
import { assertInstagramReady } from './instagram-state.js'
import { BrowseSession, SessionEnded } from './session.js'
import type { ActionLogger } from './shared.js'
import { isTemporaryUiError } from './ui-errors.js'
import { reportUiFailure, withUiDiagnosticContext } from './ui-diagnostics.js'

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
  const step = async <T>(stage: string, target: Locator, session: BrowseSession, timeoutMs: number, run: () => Promise<T>): Promise<T> => {
    const startedAt = Date.now()
    try { return await withUiDiagnosticContext({ action: 'appearance', stage, session, controls: panel }, run) }
    catch (error) {
      await reportUiFailure(target, error, { action: 'appearance', stage, session, controls: panel,
        phase: 'verification', startedAt, timeoutMs })
      throw error
    }
  }
  const click = (target: Locator, stage: string, session = setting) => step(stage, target, session, 10_000,
    () => deps.click(page, target, session, 10_000, { action: 'appearance', stage, controls: panel }))
  let opened = false
  try {
    // Leave an existing viewer or account prompt to its owning action.
    if (await page.getByRole('dialog').filter({ visible: true }).count()) {
      log({ event: 'automation.session.appearance', theme, timezone, outcome: 'skipped', reason: 'existing_dialog' })
      return
    }
    try {
      await deps.check(page, setting)
      await step('find_more', menu, setting, 3000, () => menu.waitFor({ state: 'visible', timeout: setting.timeout(3000) }))
      opened = true
      await click(menu, 'open_more')
      await click(panel.getByRole('button', { name: /Switch appearance$/ }).first(), 'open_appearance')
      const toggle = panel.getByRole('switch', { name: 'Dark mode', exact: true })
      await step('find_switch', toggle, setting, 3000, () => toggle.waitFor({ state: 'visible', timeout: setting.timeout(3000) }))
      const checked = await step('read_switch', toggle, setting, 3000, async () => {
        const value = await toggle.getAttribute('aria-checked', { timeout: setting.timeout(3000) })
        if (value !== 'true' && value !== 'false') throw new errors.TimeoutError('Appearance switch state is unavailable')
        return value
      })
      if ((checked === 'true') !== (theme === 'dark')) {
        // The row's accessible name also includes the nested switch label, so select by its control.
        // Use the row; clicking its nested input did not reliably change the saved appearance.
        const row = panel.getByRole('button').filter({ has: page.getByRole('switch', { name: 'Dark mode', exact: true }) })
        await click(row, 'change_theme')
      }
      await step('verify_theme', root, setting, 2000, () => root.waitFor({ state: 'visible', timeout: setting.timeout(2000) }))
    } finally {
      if (opened && !parent.stopped() && await moreMenu.isVisible()) {
        await click(menu, 'close_more', parent)
        await step('verify_closed', moreMenu, parent, 2000, () => moreMenu.waitFor({ state: 'hidden', timeout: parent.timeout(2000) }))
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
