import type { Locator, Page } from 'playwright-core'
import { random } from './shared.js'
import { driftMouse } from './mouse.js'
import { BrowseSession } from './session.js'

// Smooth, trackpad-like scroll using only real wheel events (never JS).
// Emits many tiny deltas on a ~60Hz cadence with an ease-in-out velocity
// profile, so the page glides instead of jumping in chunks.
export async function smoothScroll(page: Page, total: number, session = new BrowseSession()): Promise<void> {
  const sleep = session.wait
  session.check()
  const dir = Math.sign(total) || 1
  const dist = Math.abs(total)
  if (dist < 1) return
  const duration = Math.min(1500, Math.max(250, dist * random(1.0, 1.8)))
  const frames = Math.max(8, Math.floor(duration / random(14, 30)))
  let emitted = 0
  for (let i = 0; i < frames; i++) {
    session.check()
    const t = (i + 1) / frames
    // ease-in-out: slow start, fast middle, gentle settle.
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    const delta = Math.max(
      1,
      Math.round((eased * dist - emitted) * random(0.7, 1.3)),
    )
    emitted += delta
    await page.mouse.wheel(0, delta * dir).catch(() => undefined)
    await sleep(random(12, 32))
  }
}

// Sometimes humans use keys instead of the wheel. Rare; mouse owns scrolling.
async function keyScroll(page: Page, session: BrowseSession): Promise<void> {
  const sleep = session.wait
  session.check()
  const roll = Math.random()
  const key =
    roll < 0.45 ? 'Space' : roll < 0.65 ? 'PageDown' : roll < 0.88 ? 'ArrowDown' : 'ArrowUp'
  await page.keyboard.press(key).catch(() => undefined)
  await sleep(random(250, 700))
  // Key presses jump far; humans often correct with a small wheel move after.
  if (Math.random() < 0.5) {
    await smoothScroll(page, random(40, 160), session)
    await sleep(random(120, 350))
  }
}

// Grab the scrollbar and drag it, like a mouse user. Every move goes through
// Cloak's humanized cursor. Leaves the cursor parked on the scrollbar.
async function dragScrollbar(page: Page, session: BrowseSession): Promise<void> {
  const sleep = session.wait
  session.check()
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 }
  const x = viewport.width - random(4, 12)
  const startY = random(viewport.height * 0.3, viewport.height * 0.6)
  const travel = random(120, 320)
  try {
    await page.mouse.move(x, startY)
    await sleep(random(120, 350))
    await page.mouse.down()
    const legs = Math.round(random(3, 6))
    for (let i = 1; i <= legs; i++) {
      await page.mouse.move(x, startY + (travel * i) / legs)
      await sleep(random(30, 80))
    }
    await sleep(random(100, 300))
  } catch {
    // Drags can fail if the page navigated; wheel still works.
  } finally {
    await page.mouse.up().catch(() => undefined)
  }
}

export type CursorState = { onScrollbar: boolean }

// Scroll past the current post the way a mouse user would: the cursor sits
// over the content and the wheel does the work, with an occasional scrollbar
// drag or key press for variety. Travel clears the whole post so the next
// pick can't land on it again. Hesitates, then moves on.
export async function scrollPastPost(
  page: Page,
  cursor: CursorState,
  clearHeight = 0,
  session = new BrowseSession(),
): Promise<void> {
  const sleep = session.wait
  session.check()
  const roll = Math.random()
  if (roll < 0.12) {
    await dragScrollbar(page, session)
    cursor.onScrollbar = true
  } else {
    if (cursor.onScrollbar) {
      // Wheel-scrolls originate where the cursor points; move back to content.
      await driftMouse(page, undefined, undefined, session)
      cursor.onScrollbar = false
      await sleep(random(150, 400))
    }
    if (roll < 0.22) {
      await keyScroll(page, session)
    } else {
      // Full post height plus margin; falls back to the old range.
      await smoothScroll(
        page,
        random(
          Math.max(450, clearHeight + 120),
          Math.max(950, clearHeight + 350),
        ),
        session,
      )
    }
  }
  // Hesitation: short pause, sometimes a second tiny nudge.
  await sleep(random(200, 700))
  if (Math.random() < 0.3) {
    await smoothScroll(page, random(30, 120), session)
    await sleep(random(150, 400))
  }
  // Re-read: glide back up a bit.
  if (Math.random() < 0.12) {
    await sleep(random(300, 900))
    await smoothScroll(page, -random(80, 220), session)
  }
  // Never rest straddling two posts; settle on the most visible one.
  await settleOnPost(page, session)
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
export async function revealForClick(page: Page, el: Locator, session = new BrowseSession()): Promise<boolean> {
  const sleep = session.wait
  session.check()
  const vp = page.viewportSize() ?? { width: 1280, height: 800 }
  for (let i = 0; i < 3; i++) {
    const box = await el.boundingBox().catch(() => null)
    if (!box) return false
    if (box.y > 0 && box.y + Math.min(box.height, 60) < vp.height) return true
    const delta = box.y < vp.height / 2 ? box.y - 120 : box.y - vp.height + 220
    if (Math.abs(delta) < 20) return true
    await smoothScroll(page, Math.max(-600, Math.min(600, delta)), session)
    await sleep(random(300, 600))
  }
  const box = await el.boundingBox().catch(() => null)
  return !!box && box.y > 0 && box.y < vp.height
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
