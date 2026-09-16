import type { Page } from 'playwright-core'
import { BROWSER_WINDOW_WIDTH, BROWSER_WINDOW_HEIGHT } from './config.js'

// Move focus from browser chrome (address bar) into page content and park
// the OS cursor over the page so wheel input scrolls the feed.
//
// Per Playwright docs, Mouse coords are viewport-relative and
// page.bringToFront() activates the tab (moves focus off the address bar).
// Per Firefox (bug 1086524, FF133+), Escape returns address-bar focus to
// the content document. Clicking is avoided on purpose: a real click on
// Instagram could like/follow something, while move + Escape + window.focus
// is side-effect free.
export async function focusPageContent(page: Page): Promise<void> {
  try {
    await page.bringToFront()
  } catch {
    // Headless or closed page; remaining steps still help.
  }
  try {
    await page.keyboard.press('Escape')
  } catch {
    // Keyboard may be unavailable; cursor parking below still helps.
  }
  try {
    const viewport = page.viewportSize() ?? {
      width: BROWSER_WINDOW_WIDTH,
      height: BROWSER_WINDOW_HEIGHT,
    }
    await page.mouse.move(viewport.width / 2, viewport.height / 2)
  } catch {
    // Mouse may be unavailable; keyboard focus above still helps.
  }
  try {
    await page.evaluate(() => window.focus())
  } catch {
    // Page may have navigated away; safe to ignore.
  }
}
