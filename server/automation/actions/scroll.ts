import type { Locator, Page } from 'playwright-core'
import { random } from './shared.js'
import { BrowseSession } from './session.js'

type ScrollBounds = { top: number; bottom: number; left: number; right: number }
type ScrollTarget = Pick<Locator, 'boundingBox'> & { evaluate: (fn: (node: Element) => ScrollBounds) => Promise<ScrollBounds> }

/** Skip rejected content with a shorter eased wheel glide and a brief render settle. */
export async function quickScroll(page: Page, total: number, session: BrowseSession): Promise<void> {
  await smoothScroll(page, total, session, () => false, 200)
  await session.wait(50)
}

function scrollBounds(node: Element): ScrollBounds {
  const view = node.ownerDocument.defaultView!
  let parent = node.parentElement
  while (parent) {
    const style = view.getComputedStyle(parent)
    if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight) {
      const rect = parent.getBoundingClientRect()
      return { top: Math.max(0, rect.top), bottom: Math.min(view.innerHeight, rect.bottom),
        left: Math.max(0, rect.left), right: Math.min(view.innerWidth, rect.right) }
    }
    parent = parent.parentElement
  }
  return { top: 0, bottom: view.innerHeight, left: 0, right: view.innerWidth }
}

// Smooth, trackpad-like scroll using only real wheel events (never JS).
// Emits many tiny deltas on a ~60Hz cadence with an ease-in-out velocity
// profile, so the page glides instead of jumping in chunks.
export async function smoothScroll(page: Page, total: number, session = new BrowseSession(), done: () => boolean = () => false,
  durationMs?: number): Promise<void> {
  const sleep = session.wait
  session.check()
  const dir = Math.sign(total) || 1
  const dist = Math.abs(total)
  if (dist < 1) return
  const duration = durationMs ?? Math.min(1500, Math.max(250, dist * random(1.0, 1.8)))
  const frames = Math.max(8, Math.floor(duration / random(14, 30)))
  let emitted = 0
  for (let i = 0; i < frames; i++) {
    session.check()
    if (done()) return
    const t = (i + 1) / frames
    // ease-in-out: slow start, fast middle, gentle settle.
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    const delta = Math.min(dist - emitted, i === frames - 1 ? dist - emitted : Math.max(
      0, Math.round((eased * dist - emitted) * random(0.7, 1.3)),
    ))
    if (delta <= 0) continue
    emitted += delta
    await page.mouse.wheel(0, delta * dir).catch(() => undefined)
    await sleep(random(12, 32))
  }
}

// Align whichever post is most visible to fully in view. No-op when one
// already fills the viewport.
export async function settleOnPost(page: Page, session = new BrowseSession()): Promise<void> {
  session.check()
  const vp = page.viewportSize() ?? { width: 1280, height: 800 }
  const articles = page.locator('article')
  const n = await articles.count().catch(() => 0)
  let best = -1
  let bestFrac = 0
  for (let i = 0; i < n; i++) {
    const box = await articles.nth(i).boundingBox().catch(() => null)
    if (!box || box.height < 1 || box.y >= vp.height || box.y + box.height <= 0) continue
    const frac =
      (Math.min(box.y + box.height, vp.height) - Math.max(box.y, 0)) /
      box.height
    if (frac > bestFrac) {
      bestFrac = frac
      best = i
    }
  }
  if (best < 0 || bestFrac >= 0.9) return
  await alignPostOnScreen(page, articles.nth(best), session)
}

// Settle the post to 90-100% on screen with wheel input only.
// Posts taller than the viewport align to the top edge instead.
export async function alignPostOnScreen(page: Page, target: Locator, session = new BrowseSession()): Promise<void> {
  const sleep = session.wait
  session.check()
  const vp = page.viewportSize() ?? { width: 1280, height: 800 }
  for (let i = 0; i < 4; i++) {
    const box = await target.boundingBox().catch(() => null)
    if (!box || box.height < 1) return
    const frac =
      (Math.min(box.y + box.height, vp.height) - Math.max(box.y, 0)) /
      box.height
    if (frac >= 0.9) return
    const topTarget =
      box.height >= vp.height
        ? random(40, 80)
        : Math.min(random(50, 110), Math.max(0, vp.height - box.height))
    const delta = box.y - topTarget
    if (Math.abs(delta) < 30) return
    await smoothScroll(page, Math.max(-800, Math.min(800, delta)), session)
    await sleep(random(300, 700))
  }
}

// Bring an element into view with eased wheel glides (never Playwright's
// instant jump-scroll), so it can be clicked where it actually is.
export async function revealForClick(page: Page, el: ScrollTarget, session = new BrowseSession()): Promise<boolean> {
  const sleep = session.wait
  session.check()
  const vp = page.viewportSize() ?? { width: 1280, height: 800 }
  for (let i = 0; i < 12; i++) {
    const box = await el.boundingBox().catch(() => null)
    if (!box) return false
    // Use the nearest scrollable ancestor so overlays scroll instead of the page behind them.
    const bounds = await el.evaluate(scrollBounds)
    const top = bounds.top, bottom = Math.min(bounds.bottom, vp.height)
    if (bottom <= top || bounds.right <= bounds.left) return false
    if (box.x + box.width / 2 <= bounds.left || box.x + box.width / 2 >= bounds.right) return false
    const centerY = box.y + box.height / 2
    // Oversized targets cannot fit fully; reveal their interaction point instead.
    if (box.height <= bottom - top
      ? box.y >= top && box.y + box.height <= bottom
      : centerY > top && centerY < bottom) return true
    const delta = centerY - (top + bottom) / 2
    if (Math.abs(delta) < 20) return false
    await page.mouse.move((bounds.left + bounds.right) / 2, (top + bottom) / 2)
    await smoothScroll(page, Math.max(-800, Math.min(800, delta)), session)
    await sleep(random(150, 300))
  }
  return false
}

export async function scrollModal(page: Page, dialog: Locator, ticks = 3, session = new BrowseSession()): Promise<void> {
  const sleep = session.wait
  session.check()
  try {
    const box = await dialog.boundingBox()
    if (!box) return
    await page.mouse.move(
      box.x + box.width * random(0.3, 0.7),
      box.y + Math.min(box.height * 0.5, 400),
    )
    for (let i = 0; i < ticks; i++) {
      // Same eased wheel glide as the feed; goes to the dialog under cursor.
      await smoothScroll(page, random(250, 500), session)
      await sleep(random(400, 900))
    }
  } catch {
    // Modal may have closed mid-scroll; safe to ignore.
  }
}
