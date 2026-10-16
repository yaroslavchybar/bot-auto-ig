import type { Locator, Page } from 'playwright-core'
import { clickLiveAction } from './action-locator.js'
import { assertInstagramReady } from './instagram-state.js'
import { smoothScroll } from './scroll.js'
import { BrowseSession } from './session.js'
import { random } from './shared.js'

/** Target the comment list itself, keeping wheel input off the Reel behind the panel. */
export function commentScrollBounds(panel: Element) {
  const view = panel.ownerDocument.defaultView!
  const candidates = new Set<Element>()
  // Prefer the comment thread over an enclosing scrollable dialog.
  for (const comment of panel.querySelectorAll('a[href*="/c/"]')) {
    for (let node = comment.parentElement; node && panel.contains(node); node = node.parentElement)
      candidates.add(node)
  }
  for (const node of panel.querySelectorAll('div, ul')) candidates.add(node)
  candidates.add(panel)
  for (const node of candidates) {
    if (!/(auto|scroll)/.test(view.getComputedStyle(node).overflowY) || node.scrollHeight <= node.clientHeight) continue
    const rect = node.getBoundingClientRect()
    const left = Math.max(0, rect.left), right = Math.min(view.innerWidth, rect.right)
    const top = Math.max(0, rect.top), bottom = Math.min(view.innerHeight, rect.bottom)
    if (right > left && bottom > top) {
      const remaining = Math.max(0, node.scrollHeight - node.clientHeight - node.scrollTop)
      return { left, right, top, bottom, remaining, atEnd: remaining <= 2 }
    }
  }
  return null
}

/** Read an already-open comment thread, including the thread beside a profile post. */
export async function scrollPostComments(page: Page, panel: Locator, session: BrowseSession): Promise<void> {
  await session.wait(random(1500, 3000))
  const scrolls = Math.floor(random(2, 5))
  for (let i = 0; i < scrolls; i++) {
    const bounds = await panel.evaluate(commentScrollBounds, undefined, { timeout: session.timeout(1000) })
    if (!bounds || bounds.atEnd) break
    await page.mouse.move(bounds.left + (bounds.right - bounds.left) * random(0.35, 0.65),
      bounds.top + (bounds.bottom - bounds.top) * random(0.35, 0.65))
    await smoothScroll(page, Math.min(random(120, 300), bounds.remaining), session)
    await session.wait(random(1200, 2600))
  }
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
    await scrollPostComments(page, panel, session)
  } finally {
    if (!parent.stopped() && await panel.isVisible()) {
      const close = panel.locator('svg[aria-label="Close"]').first()
      await clickLiveAction(page, close, parent)
      await panel.waitFor({ state: 'hidden', timeout: parent.timeout(2500) })
    }
  }
}
