import type { Page } from 'playwright-core'
import { random, sleep, type ActionLogger } from './shared.js'

export async function closeDialog(page: Page): Promise<void> {
  // X button first (real <button> with Close icon); Escape as fallback.
  try {
    const dialog = page.locator('div[role="dialog"]').first()
    const scope = (await dialog.isVisible().catch(() => false)) ? dialog : page
    const x = scope.locator('svg[aria-label="Close"]').first()
    if (await x.isVisible().catch(() => false)) {
      await x.click({ timeout: 5_000 })
      await sleep(random(400, 900))
      return
    }
  } catch {
    // Fall through to Escape.
  }
  await page.keyboard.press('Escape').catch(() => undefined)
  await sleep(random(300, 700))
}

// Sidebar Home button. True if home loaded.
async function goHomeViaUi(page: Page): Promise<boolean> {
  try {
    const home = page.locator('a:has(svg[aria-label="Home"])').first()
    if (!(await home.isVisible().catch(() => false))) return false
    await home.click({ timeout: 5_000 })
    await page
      .waitForURL(/instagram\.com\/(\?.*)?$/, { timeout: 10_000 })
      .catch(() => undefined)
    await sleep(random(1200, 2500))
    return /instagram\.com\/(\?.*)?$/.test(page.url())
  } catch {
    return false
  }
}

// Back to feed the human way: browser Back (Alt+Left, same as the back
// button) until the feed shows, then sidebar Home. Direct goto last resort.
export async function backToFeed(page: Page, log: ActionLogger): Promise<void> {
  for (let i = 0; i < 3; i++) {
    if (/instagram\.com\/(\?.*)?$/.test(page.url())) {
      const posts = await page.locator('article').count().catch(() => 0)
      if (posts > 0) {
        if (i > 0) log('Went back to feed')
        return
      }
    }
    await page.keyboard.press('Alt+ArrowLeft').catch(() => undefined)
    await sleep(random(1500, 2500))
  }
  if (await goHomeViaUi(page).catch(() => false)) return
  await page
    .goto('https://www.instagram.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    .catch(() => undefined)
}
