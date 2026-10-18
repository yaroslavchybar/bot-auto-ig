import type { Page } from 'playwright-core'
import type { BrowseSession } from './session.js'

/** Capture an unchanged viewport. Browser-side clipping can briefly resize the compositor. */
export async function captureViewportScreenshot(page: Page, session: BrowseSession): Promise<Buffer> {
  const screenshot = await page.screenshot({
    type: 'png',
    scale: 'css',
    fullPage: false,
    // Hiding carets also temporarily changes styles in Instagram's comment fields.
    caret: 'initial',
    timeout: session.timeout(5000),
  })
  session.check()
  return screenshot
}
