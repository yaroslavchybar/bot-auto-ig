import type { Locator, Page } from 'playwright-core'
import { random, sleep } from './shared.js'
import { clickPointOnScreen } from './guards.js'

export async function clickVisible(
  page: Page | Locator,
  selector: string,
): Promise<boolean> {
  const locator = 'locator' in page ? page.locator(selector) : page
  for (let i = 0; i < Math.min(await locator.count(), 5); i++) {
    const item = locator.nth(i)
    if (await item.isVisible().catch(() => false)) {
      await item.click({ timeout: 5_000 })
      return true
    }
  }
  return false
}

export async function likeVisible(page: Page | Locator): Promise<boolean> {
  return clickVisible(page, 'svg[aria-label="Like"], button[aria-label="Like"]')
}

export async function followVisible(page: Page | Locator): Promise<boolean> {
  return clickVisible(
    page,
    'button:text-is("Follow"), div[role="button"]:text-is("Follow"), button:text-is("Follow Back"), div[role="button"]:text-is("Follow Back")',
  )
}

// Park the cursor somewhere neutral. A single move call lets Cloak draw
// its own human curve instead of our linear interpolation.
export async function driftMouse(page: Page, x?: number, y?: number): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 }
  try {
    await page.mouse.move(
      x ?? random(viewport.width * 0.3, viewport.width * 0.7),
      y ?? random(viewport.height * 0.3, viewport.height * 0.7),
    )
  } catch {
    // Mouse may be unavailable in some contexts; scrolling still works.
  }
}

export async function hoverPost(
  page: Page,
  target: Locator,
): Promise<void> {
  try {
    const box = await target.boundingBox()
    if (!box) return
    // Never chase off-screen posts; the cursor would fly to the window top.
    const vp = page.viewportSize() ?? { width: 1280, height: 800 }
    if (!clickPointOnScreen(box, vp)) return
    // Single move: Cloak draws the human curve.
    await page.mouse.move(
      box.x + box.width * random(0.3, 0.7),
      box.y + Math.min(box.height * random(0.3, 0.6), 500),
    )
  } catch {
    // Post may have scrolled away; safe to ignore.
  }
}
