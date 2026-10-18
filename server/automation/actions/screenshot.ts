import sharp from 'sharp'
import type { CDPSession, Page } from 'playwright-core'
import type { BrowseSession } from './session.js'

/** Capture the existing view; Playwright adds a compositor clip even without a clip option. */
export async function captureViewportScreenshot(
  page: Page,
  session: BrowseSession,
): Promise<Buffer> {
  const timeout = session.timeout(5000),
    deadline = Date.now() + timeout
  let attached: Promise<CDPSession> | undefined, timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Viewport screenshot timed out')), timeout)
  })
  try {
    const work = async () => {
      attached = page.context().newCDPSession(page)
      const cdp = await attached
      session.check()
      if (Date.now() >= deadline) throw new Error('Viewport screenshot timed out')
      const viewport =
        page.viewportSize() ??
        (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
      session.check()
      if (Date.now() >= deadline) throw new Error('Viewport screenshot timed out')
      const { data } = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: false,
        captureBeyondViewport: false,
      })
      session.check()
      const screenshot = Buffer.from(data, 'base64'),
        metadata = await sharp(screenshot).metadata()
      if (
        !metadata.width ||
        !metadata.height ||
        Math.abs(metadata.width / viewport.width - metadata.height / viewport.height) >
          1 / Math.min(viewport.width, viewport.height)
      )
        throw new Error('Screenshot dimensions do not match the viewport')
      // Normalize native display pixels to CSS pixels without changing browser metrics or styles.
      const image =
        metadata.width === viewport.width && metadata.height === viewport.height
          ? screenshot
          : await sharp(screenshot).resize(viewport.width, viewport.height).png().toBuffer()
      session.check()
      return image
    }
    return await Promise.race([work(), expired])
  } finally {
    clearTimeout(timer)
    // Detach even when attachment completes after the deadline; never leave a CDP session behind.
    void attached?.then((cdp) => cdp.detach()).catch(() => {})
  }
}
