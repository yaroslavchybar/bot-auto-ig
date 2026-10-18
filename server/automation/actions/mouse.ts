import type { Locator, Page } from 'playwright-core'
import { random } from './shared.js'
import { clickPointOnScreen } from './guards.js'
import { BrowseSession } from './session.js'
import { actionLocator } from './action-locator.js'
import { desktopCursorFor } from '../../browser/desktopPointer.js'

const nextScrollDrift = new WeakMap<Page, number>()
const fallbackScrollCursors = new WeakMap<Page, Readonly<{ x: number; y: number }>>()

// Keep a safe cursor still between scrolls, with small drift at irregular time intervals.
export async function positionScrollCursor(page: Page, bounds: { left: number; right: number; top: number; bottom: number },
  session: BrowseSession): Promise<{ x: number; y: number }> {
  session.check()
  const { left, right, top, bottom } = bounds
  const width = right - left, height = bottom - top
  const cursor = desktopCursorFor(page) ?? fallbackScrollCursors.get(page)
  const inside = cursor && cursor.x > left + width * 0.15 && cursor.x < right - width * 0.15 &&
    cursor.y > top + height * 0.15 && cursor.y < bottom - height * 0.15
  if (inside && !nextScrollDrift.has(page)) nextScrollDrift.set(page, Date.now() + random(20_000, 45_000))
  if (inside && Date.now() < nextScrollDrift.get(page)!) return cursor
  const drift = (position: number, min: number, max: number) => {
    const span = max - min, distance = Math.min(45, span * 0.1)
    return Math.max(min + span * 0.15, Math.min(max - span * 0.15, position + random(-distance, distance)))
  }
  const point = inside ? {
    x: drift(cursor.x, left, right),
    y: drift(cursor.y, top, bottom),
  } : { x: left + width * random(0.3, 0.7), y: top + height * random(0.3, 0.7) }
  await page.mouse.move(point.x, point.y)
  fallbackScrollCursors.set(page, point)
  session.check()
  nextScrollDrift.set(page, Date.now() + random(20_000, 45_000))
  return point
}

export async function clickVisible(
  page: Page | Locator,
  selector: string,
  session = new BrowseSession(),
): Promise<boolean> {
  const locator = 'locator' in page ? page.locator(selector) : page
  for (let i = 0; i < Math.min(await locator.count(), 5); i++) {
    const item = locator.nth(i)
    const box = await item.boundingBox().catch(() => null)
    const vp = item.page().viewportSize() ?? { width: 1280, height: 800 }
    if (box && clickPointOnScreen(box, vp) && await item.isVisible().catch(() => false)) {
      const timeout = session.timeout(5_000)
      await (await actionLocator(item, timeout)).click({ timeout: session.timeout(5_000) })
      return true
    }
  }
  return false
}

// Park the cursor somewhere neutral. A single move call lets Cloak draw
// its own human curve instead of our linear interpolation.
export async function driftMouse(page: Page, x?: number, y?: number, session = new BrowseSession()): Promise<void> {
  session.check()
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
