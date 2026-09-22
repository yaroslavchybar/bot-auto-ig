import type { Page } from 'playwright-core'
import { random, type ActionLogger } from './shared.js'
import { BrowseSession } from './session.js'

// Blocking Instagram overlays ("Turn on Notifications", "Save your login
// info") render seconds after navigation, so wait for them instead of
// peeking. Click "Not Now" only, never "Turn On".
export async function dismissPopups(page: Page, session = new BrowseSession()): Promise<void> {
  session.check()
  const notNow = page
    .getByRole('dialog')
    .getByRole('button', { name: 'Not Now' })
    .first()
  const shown = await notNow
    .waitFor({ state: 'visible', timeout: session.timeout(3_000) })
    .then(() => true, () => false)
  if (!shown) return
  session.check()
  await notNow.click({ timeout: session.timeout(3_000) }).catch(() => undefined)
  await session.wait(random(300, 700))
}

export async function closeDialog(page: Page, session = new BrowseSession()): Promise<void> {
  const sleep = session.wait
  session.check()
  // X button first (real <button> with Close icon); Escape as fallback.
  try {
    const dialog = page.locator('div[role="dialog"]').first()
    const scope = (await dialog.isVisible().catch(() => false)) ? dialog : page
    const x = scope.locator('svg[aria-label="Close"]').first()
    if (await x.isVisible().catch(() => false)) {
      await x.click({ timeout: session.timeout(5_000) })
      await sleep(random(400, 900))
      return
    }
  } catch {
  }
  session.check()
  await page.keyboard.press('Escape').catch(() => undefined)
  await sleep(random(300, 700))
}

// Sidebar Home button. True if home loaded.
async function goHomeViaUi(page: Page, session: BrowseSession): Promise<boolean> {
  const sleep = session.wait
  session.check()
  try {
    const home = page.locator('a:has(svg[aria-label="Home"])').first()
    if (!(await home.isVisible().catch(() => false))) return false
    await home.click({ timeout: session.timeout(5_000) })
    await page
      .waitForURL(/instagram\.com\/(\?.*)?$/, { timeout: session.timeout(10_000) })
      .catch(() => undefined)
    await sleep(random(1200, 2500))
    return /instagram\.com\/(\?.*)?$/.test(page.url())
  } catch {
    return false
  }
}

// Back to feed the human way: browser Back (Alt+Left, same as the back
// button) until the feed shows, then sidebar Home. Direct goto last resort.
export async function backToFeed(page: Page, log: ActionLogger, session = new BrowseSession()): Promise<void> {
  const sleep = session.wait
  session.check()
  for (let i = 0; i < 3; i++) {
    if (/instagram\.com\/(\?.*)?$/.test(page.url())) {
      const posts = await page.locator('article').count().catch(() => 0)
      if (posts > 0) {
        if (i > 0) log('Went back to feed')
        return
      }
    }
    session.check()
    await page.keyboard.press('Alt+ArrowLeft').catch(() => undefined)
    await sleep(random(1500, 2500))
  }
  if (await goHomeViaUi(page, session).catch(() => false)) return
  await page
    .goto('https://www.instagram.com/', {
      waitUntil: 'domcontentloaded',
      timeout: session.timeout(30_000),
    })
    .catch(() => undefined)
}
