import type { Page } from 'playwright-core'
import { random, sleep, type ActionLogger } from './shared.js'
import { smoothScroll } from './scroll.js'

// DMs via the sidebar Messages button. List level only: scroll a little,
// read, never open a thread (no read receipts).
export async function openDMs(page: Page, log: ActionLogger): Promise<boolean> {
  try {
    const msgs = page.locator('a:has(svg[aria-label="Messages"])').first()
    if (!(await msgs.isVisible().catch(() => false))) return false
    await msgs.click({ timeout: 5_000 })
    await page
      .waitForURL(/instagram\.com\/direct\/inbox\/?/, { timeout: 10_000 })
      .catch(() => undefined)
    await sleep(random(1500, 2500))
    if (!/\/direct\/inbox\/?/.test(page.url())) return false
    log('Checking messages')
    const looks = Math.round(random(1, 3))
    for (let i = 0; i < looks; i++) {
      await smoothScroll(page, random(200, 400))
      await sleep(random(900, 1800))
    }
    await sleep(random(2000, 4000))
    return true
  } catch {
    return false
  }
}
