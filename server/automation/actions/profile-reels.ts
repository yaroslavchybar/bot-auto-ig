import type { Locator, Page } from 'playwright-core'
import { clickLiveAction } from './action-locator.js'
import { assertInstagramReady } from './instagram-state.js'
import { revealForClick, smoothScroll } from './scroll.js'
import { BrowseSession } from './session.js'
import { random, type ActionLogger } from './shared.js'
import { viewVideo } from './viewing.js'
import { isTemporaryUiError } from './ui-errors.js'

export type ProfileReel = { href: string; views: number }
export type ProfileReelEngagement = (article: Locator, session: BrowseSession) => Promise<void>

/** Read only on-screen view badges; hover Like/comment counts are unrelated. */
export function visibleProfileReels(links: Element[]): ProfileReel[] {
  const results: ProfileReel[] = []
  for (const link of links) {
    const view = link.ownerDocument.defaultView!
    const icon = link.querySelector('svg[aria-label="View Count Icon"]')
    const rect = icon?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height || rect.bottom <= 0 || rect.top >= view.innerHeight ||
      rect.right <= 0 || rect.left >= view.innerWidth || view.getComputedStyle(icon!).visibility === 'hidden') continue
    const href = link.getAttribute('href') ?? ''
    if (!/^\/[\w.]+\/reel\/[\w-]+\/$/.test(href)) continue
    const label = icon!.parentElement?.nextElementSibling?.textContent?.replace(/[,\s]/g, '') ?? ''
    const count = label.match(/^(\d+(?:\.\d+)?)([KMB])?$/i)
    if (!count) continue
    const views = Number(count[1]) * ({ K: 1000, M: 1e6, B: 1e9 }[count[2]?.toUpperCase() ?? ''] ?? 1)
    if (Number.isFinite(views)) results.push({ href, views })
  }
  return results
}

/** Sample the scrolled grid, then watch its 1–3 most-viewed Reels in dialogs. */
export async function watchProfileReels(page: Page, session: BrowseSession, parent: BrowseSession,
  log: ActionLogger, engage?: ProfileReelEngagement): Promise<{ scrolls: number; watched: number }> {
  const tiles = page.locator('main a[href*="/reel/"]')
  if (!await tiles.count()) {
    try { await tiles.first().waitFor({ state: 'visible', timeout: session.timeout(5000) }) }
    catch (error) {
      session.check()
      await assertInstagramReady(page, session)
      if (!isTemporaryUiError(error)) throw error
      return { scrolls: 0, watched: 0 }
    }
  }
  const sampled = new Map<string, ProfileReel>()
  const collect = async () => {
    for (const tile of await tiles.evaluateAll(visibleProfileReels)) sampled.set(tile.href, tile)
  }
  await collect()
  let scrolls = 0, watched = 0
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 }
  await page.mouse.move(viewport.width * random(0.45, 0.7), viewport.height * random(0.4, 0.65))
  for (let i = 0, count = Math.floor(random(2, 4)); i < count; i++) {
    await smoothScroll(page, random(250, 500), session)
    scrolls++
    await session.wait(random(1000, 2000))
    await collect()
  }
  const selected = [...sampled.values()].sort((a, b) => b.views - a.views).slice(0, Math.floor(random(1, 4)))
  log({ event: 'automation.engagement.profile_reels_selected', sampled: sampled.size, selected })
  const gridUrl = page.url()
  for (const item of selected) {
    session.check()
    if (session.end - Date.now() < 10_000) break
    const tile = page.locator(`main a[href="${item.href}"]`).first()
    if (!await revealForClick(page, tile, session)) continue
    const dialog = page.getByRole('dialog').filter({ visible: true }).last()
    try {
      await clickLiveAction(page, tile, session)
      const article = dialog.locator('article').first()
      await article.waitFor({ state: 'visible', timeout: session.timeout(5000) })
      await assertInstagramReady(page, session)
      const video = article.locator('video').first()
      await video.waitFor({ state: 'visible', timeout: session.timeout(5000) })
      const muted = article.locator('svg[aria-label="Audio is muted"]').first()
      if (await muted.isVisible()) await clickLiveAction(page, muted, session)
      const clip = await video.evaluate(node => (node as HTMLVideoElement).duration)
      const dwell = Number.isFinite(clip) && clip > 0 ? Math.min(20, Math.max(3, clip * random(0.5, 1))) : random(6, 12)
      if (await viewVideo(video, dwell * 1000, session)) {
        watched++
        log({ event: 'automation.engagement.profile_reel_viewed', href: item.href, views: item.views })
        await engage?.(article, session)
      }
    } finally {
      // This viewer's X is outside role=dialog. Close it before any history input.
      if (!parent.stopped() && await dialog.isVisible()) {
        const close = page.locator('svg[aria-label="Close"]').filter({ visible: true }).last()
        await clickLiveAction(page, close, parent)
        await dialog.waitFor({ state: 'hidden', timeout: parent.timeout(3000) })
        await page.waitForURL(gridUrl, { waitUntil: 'commit', timeout: parent.timeout(3000) })
      }
    }
  }
  return { scrolls, watched }
}
