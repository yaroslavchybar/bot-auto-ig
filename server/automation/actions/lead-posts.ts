import type { Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { UnsupportedHumanizeSelectorError } from 'cloakbrowser/human'
import { clickLiveAction } from './action-locator.js'
import { assertInstagramReady } from './instagram-state.js'
import { likePost } from './engagement.js'
import { decideLeadPost } from './lead-post-decision.js'
import { captureTopicScreenshot } from './topic-intent.js'
import { revealForClick, smoothScroll } from './scroll.js'
import { BrowseSession, SessionEnded } from './session.js'
import { random, type ActionLogger } from './shared.js'
import { viewVideo } from './viewing.js'
import { isTemporaryUiError } from './ui-errors.js'

/** Only this profile's on-screen grid tiles; never suggested accounts or unrelated links. */
export function visibleLeadPosts(links: Element[], username: string): string[] {
  return [...new Set(links.flatMap(link => {
    const href = link.getAttribute('href') ?? '', match = href.match(/^\/([\w.]+)\/(?:p|reel)\/[\w-]+\/$/)
    if (match?.[1].toLowerCase() !== username.toLowerCase()) return []
    const box = link.getBoundingClientRect(), view = link.ownerDocument.defaultView!
    return box.width > 100 && box.height > 100 && box.bottom > 0 && box.top < view.innerHeight &&
      box.right > 0 && box.left < view.innerWidth && view.getComputedStyle(link).visibility !== 'hidden' ? [href] : []
  }))]
}

/** Pick loaded main media by visible area, excluding avatars and offscreen carousel slides. */
export function leadPostMediaIndex(nodes: Element[]): number {
  let index = -1, largest = 0
  for (const [i, node] of nodes.entries()) {
    const box = node.getBoundingClientRect(), view = node.ownerDocument.defaultView!
    if (!node.isConnected || box.width < 150 || box.height < 150 || view.getComputedStyle(node).visibility === 'hidden') continue
    if (node.tagName === 'IMG' && (!(node as HTMLImageElement).complete || !(node as HTMLImageElement).naturalWidth)) continue
    const area = Math.max(0, Math.min(box.right, view.innerWidth) - Math.max(0, box.left)) *
      Math.max(0, Math.min(box.bottom, view.innerHeight) - Math.max(0, box.top))
    if (area > largest) { largest = area; index = i }
  }
  return index
}

const dependencies = { decide: decideLeadPost, capture: captureTopicScreenshot, like: likePost,
  click: clickLiveAction, reveal: revealForClick, scroll: smoothScroll, video: viewVideo,
  check: assertInstagramReady, random, wait: (session: BrowseSession, ms: number) => session.wait(ms) }

/** Browse 1–3 public lead posts before a DM. This is never called by feed/Reel profile visits. */
export async function browseLeadPosts(page: Page, username: string, parent: BrowseSession, log: ActionLogger,
  deps = dependencies): Promise<void> {
  parent.check()
  if (parent.end - Date.now() < 20_000) return
  const gridUrl = page.url()
  const correctProfile = () => new URL(page.url()).pathname.toLowerCase() === `/${username.toLowerCase()}/`
  if (!correctProfile()) throw new errors.TimeoutError('Lead profile navigation changed')
  const session = new BrowseSession(Math.min(parent.end - 8000, Date.now() + 75_000), () => parent.stopped())
  const main = page.locator('main'), tiles = main.locator('a[href*="/p/"], a[href*="/reel/"]')
  await main.locator('header').waitFor({ state: 'visible', timeout: session.timeout(5000) })
  const privateNotice = main.getByText(/^(This profile is private|This account is private)$/)
  const emptyNotice = main.getByText('No posts yet', { exact: true })
  // Wait for a definitive loaded state; an initially empty grid may still be loading.
  await tiles.first().or(privateNotice).or(emptyNotice).first().waitFor({ state: 'visible', timeout: session.timeout(5000) })
  if (!correctProfile()) throw new errors.TimeoutError('Lead profile navigation changed')
  if (await privateNotice.isVisible() || await emptyNotice.isVisible()) {
    log({ event: 'automation.lead_posts.skipped', reason: await privateNotice.isVisible() ? 'private' : 'no_posts' })
    return
  }
  const sampled = new Set<string>()
  const collect = async () => {
    for (const href of await tiles.evaluateAll(visibleLeadPosts, username)) sampled.add(href)
  }
  try {
    await collect()
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 }
    await page.mouse.move(viewport.width * deps.random(0.45, 0.7), viewport.height * deps.random(0.4, 0.65))
    for (let i = 0, count = Math.floor(deps.random(1, 3)); i < count; i++) {
      session.check()
      if (!correctProfile()) throw new errors.TimeoutError('Lead profile navigation changed')
      await deps.scroll(page, deps.random(250, 500), session)
      await deps.wait(session, deps.random(700, 1400))
      await collect()
    }
    const candidates = [...sampled]
    const selected: string[] = []
    for (let i = 0, count = Math.floor(deps.random(1, 4)); i < count && candidates.length; i++) {
      selected.push(candidates.splice(Math.floor(deps.random(0, candidates.length)), 1)[0])
    }
    for (const href of selected) {
      session.check()
      if (session.end - Date.now() < 12_000) break
      if (!correctProfile()) throw new errors.TimeoutError('Lead profile navigation changed')
      const tile = main.locator(`a[href="${href}"]`).first()
      if (!await deps.reveal(page, tile, session)) continue
      const dialog = page.getByRole('dialog').filter({ visible: true }).last()
      try {
        await deps.click(page, tile, session)
        const article = dialog.locator('article').first()
        await article.waitFor({ state: 'visible', timeout: session.timeout(5000) })
        const id = href.split('/').at(-2)!
        const correctPost = () => new RegExp(`^/(?:p|reel|reels)/${id}/$`).test(new URL(page.url()).pathname)
        if (!correctPost() || !await article.locator(`header a[href="/${username}/"]`).count())
          throw new errors.TimeoutError('Opened post does not belong to the lead')
        await deps.check(page, session)
        const mediaNodes = article.locator('img, video')
        let index = -1
        for (let tries = 0; tries < 15; tries++) {
          index = await mediaNodes.evaluateAll(leadPostMediaIndex)
          if (index >= 0) break
          await deps.wait(session, 200)
        }
        if (index < 0) continue
        const media = mediaNodes.nth(index)
        if (await media.evaluate(node => node.tagName === 'VIDEO')) {
          const muted = article.locator('svg[aria-label="Audio is muted"]').first()
          if (await muted.isVisible()) await deps.click(page, muted, session)
          if (!await deps.video(media, deps.random(4000, 9000), session)) continue
        } else await deps.wait(session, deps.random(2500, 5000))
        log({ event: 'automation.lead_posts.viewed', href })
        const actions = article.locator('section:has(svg[aria-label="Comment"])').first()
        if (!await actions.isVisible() || await actions.locator('svg[aria-label="Unlike"]').count()) continue
        // Preserve the media identity across the screenshot/provider wait.
        const source = await media.getAttribute('src')
        let decision
        try {
          // Match Reels capture: screenshot the opened post container, not its image element.
          decision = await deps.decide(await deps.capture(article, session), session.timeout(5000))
        } catch (error) {
          session.check()
          await deps.check(page, session)
          log({ event: 'automation.lead_posts.decision_failed', href, error, outcome: 'skipped' })
          continue
        }
        session.check()
        if (!correctPost() || source !== await media.getAttribute('src')) continue
        log({ event: 'automation.lead_posts.classified', href, ...decision })
        // No interest check, random chance, or daily Like cap for lead outreach.
        if (decision.person) await deps.like(page, actions, undefined, session, log, 100, async () => {
          if (!correctPost() || source !== await media.getAttribute('src') ||
            !await article.locator(`header a[href="/${username}/"]`).count())
            throw new errors.TimeoutError('Lead post changed before Like')
        })
      } catch (error) {
        if (error instanceof SessionEnded) throw error
        session.check()
        await deps.check(page, session)
        if (!isTemporaryUiError(error) && !(error instanceof UnsupportedHumanizeSelectorError)) throw error
        log({ event: 'automation.lead_posts.action_skipped', href, error })
      } finally {
        if (!parent.stopped() && await dialog.isVisible()) {
          // Instagram places the viewer's X outside role=dialog.
          await deps.click(page, page.locator('svg[aria-label="Close"]').filter({ visible: true }).last(), parent)
          await dialog.waitFor({ state: 'hidden', timeout: parent.timeout(3000) })
          await page.waitForURL(gridUrl, { waitUntil: 'commit', timeout: parent.timeout(3000) })
        }
      }
    }
  } finally {
    // Return to the same lead's Follow controls after browsing, using smooth wheel input.
    if (!parent.stopped() && correctProfile()) await deps.reveal(page, main.locator('header'), parent)
  }
  if (!parent.stopped() && (!correctProfile() || await page.getByRole('dialog').filter({ visible: true }).count()))
    throw new errors.TimeoutError('Lead profile was not restored after browsing')
}
