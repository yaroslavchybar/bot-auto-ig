import type { Locator, Page } from 'playwright-core'
import { clickLiveAction } from './action-locator.js'
import { assertInstagramReady } from './instagram-state.js'
import { smoothScroll } from './scroll.js'
import { BrowseSession } from './session.js'
import { random } from './shared.js'

/** Target the comment list itself, keeping wheel input off the Reel behind the panel. */
export function commentScrollBounds(panel: Element) {
  const view = panel.ownerDocument.defaultView!
  for (const node of panel.querySelectorAll<HTMLElement>('div, ul')) {
    if (!/(auto|scroll)/.test(view.getComputedStyle(node).overflowY) || node.scrollHeight <= node.clientHeight) continue
    const rect = node.getBoundingClientRect()
    const left = Math.max(0, rect.left), right = Math.min(view.innerWidth, rect.right)
    const top = Math.max(0, rect.top), bottom = Math.min(view.innerHeight, rect.bottom)
    if (right > left && bottom > top)
      return { left, right, top, bottom, atEnd: node.scrollTop + node.clientHeight >= node.scrollHeight - 2 }
  }
  return null
}

/** Read in short scrolls with pauses; close via X even when reading runs out of time. */
export async function readPostComments(page: Page, comments: Locator, parent: BrowseSession): Promise<void> {
  const session = new BrowseSession(Math.min(parent.end - 2500, Date.now() + 15_000), () => parent.stopped())
  session.wait = async ms => { await parent.wait(session.timeout(ms)); session.check() }
  session.check()
  const panel = page.getByRole('dialog').filter({ visible: true }).last()
  try {
    await clickLiveAction(page, comments.locator('svg[aria-label="Comment"]').first(), session)
    await panel.waitFor({ state: 'visible', timeout: session.timeout(5000) })
    await assertInstagramReady(page, session)
    await session.wait(random(1500, 3000))
    const scrolls = Math.floor(random(2, 5))
    for (let i = 0; i < scrolls; i++) {
      const bounds = await panel.evaluate(commentScrollBounds, undefined, { timeout: session.timeout(1000) })
      if (!bounds || bounds.atEnd) break
      await page.mouse.move(bounds.left + (bounds.right - bounds.left) * random(0.35, 0.65),
        bounds.top + (bounds.bottom - bounds.top) * random(0.35, 0.65))
      await smoothScroll(page, random(120, 300), session)
      await session.wait(random(1200, 2600))
    }
  } finally {
    if (!parent.stopped() && await panel.isVisible()) {
      const close = panel.locator('svg[aria-label="Close"]').first()
      await clickLiveAction(page, close, parent)
      await panel.waitFor({ state: 'hidden', timeout: parent.timeout(2500) })
    }
  }
}
