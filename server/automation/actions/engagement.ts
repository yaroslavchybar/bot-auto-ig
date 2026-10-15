import type { Locator, Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { nativeDoubleClickFor, type NativeDoubleClick } from '../../browser/desktopPointer.js'
import { isTransientDomIssue } from '../../shared/domErrors.js'
import type { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { engagementMatches, type FeedPostContext } from '../../shared/warmupTopics.js'
import { topicContentMatches, type TopicMatcher } from './topic-intent.js'
import { actionLocator } from './action-locator.js'
import { revealForClick, scrollModal } from './scroll.js'
import { assertInstagramReady } from './instagram-state.js'
import { BrowseSession, SessionEnded } from './session.js'
import { visitAuthorProfile } from './profiles.js'
import { isInstagramHome } from './navigation.js'
import { random, type ActionLogger } from './shared.js'

const control = (target: Locator, label: string) => target.locator(
  `button:has(svg[aria-label="${label}"]), [role="button"]:has(svg[aria-label="${label}"])`).first()

/** Native input needs a final hit test after Cloak moves onto the pinned Reel. */
async function nativeReelDoubleTap(page: Page, surface: Locator, target: Locator,
  session: BrowseSession, doubleClick: NativeDoubleClick): Promise<boolean> {
  const deadline = Date.now() + session.timeout(15_000), url = page.url()
  const remaining = () => {
    const time = deadline - Date.now()
    if (time <= 0) throw new errors.TimeoutError('Reel double-tap timed out while moving to its target')
    return session.timeout(time)
  }
  const element = await surface.elementHandle({ timeout: remaining() })
  if (!element) throw new errors.TimeoutError('Reel double-tap target is missing')
  try {
    const box = await element.boundingBox()
    if (!box) throw new errors.TimeoutError('Reel double-tap target is hidden')
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    // Cloak's handle hover picks its own point; move to the exact native click point instead.
    remaining()
    await page.mouse.move(point.x, point.y)
    session.check(); await assertInstagramReady(page)
    if (await control(target, 'Unlike').isVisible() || !await control(target, 'Like').isVisible()) return false
    const ready = page.url() === url && await element.evaluate((node, point) => {
      const hit = node.ownerDocument.elementFromPoint(point.x, point.y)
      return node.isConnected && hit !== null && node.contains(hit)
    }, point)
    if (!ready) throw new errors.TimeoutError('Reel double-tap target moved or is covered')
    await doubleClick(point.x, point.y, remaining())
    return true
  } finally { await element.dispose().catch(() => {}) }
}

/** Likes and occasional extras share one daily budget; never use comment or neighboring-post controls. */
export async function engagePost(page: Page, target: Locator,
  context: Pick<FeedPostContext, 'text' | 'relationship'>, topics: readonly string[], budget: WarmupActivityBudget,
  session: BrowseSession, log: ActionLogger, matchesTopic: TopicMatcher = topicContentMatches, likeSurface?: Locator,
  visit: typeof visitAuthorProfile = visitAuthorProfile,
  nativeDoubleClick: NativeDoubleClick | undefined = nativeDoubleClickFor(page)): Promise<void> {
  const related = topics.length > 0 && await matchesTopic(context, topics, session, log, target)
  if (!engagementMatches(context, topics, related)) return
  const optional = async (action: string, perform: () => Promise<void>) => {
    try { await perform() }
    catch (error) {
      if (error instanceof SessionEnded) throw error
      session.check()
      await assertInstagramReady(page)
      if (!(error instanceof errors.TimeoutError) && !isTransientDomIssue(error)) throw error
      log({ event: 'automation.engagement.action_skipped', action, error })
    }
  }
  await optional('like', async () => {
    if (budget.remaining('likes') && !await target.locator('svg[aria-label="Unlike"]').count()) {
      const like = control(target, 'Like')
      const surface = likeSurface ?? like
      if (await surface.isVisible() && await revealForClick(page, surface, session)) {
        session.check(); await assertInstagramReady(page)
        if (budget.take('likes')) {
          if (likeSurface) {
            if (nativeDoubleClick) {
              if (!await nativeReelDoubleTap(page, surface, target, session, nativeDoubleClick)) return
            } else {
              await (await actionLocator(surface, session.timeout(15_000))).dblclick({ timeout: session.timeout(15_000) })
            }
            // Some web Reels layouts only toggle playback on double-click. Confirm before falling back.
            const liked = await control(target, 'Unlike').waitFor({ state: 'visible', timeout: session.timeout(2000) })
              .then(() => true, error => { if (error instanceof errors.TimeoutError) return false; throw error })
            if (liked) { log({ event: 'automation.engagement.liked', method: nativeDoubleClick ? 'native_double_tap' : 'double_tap' }); return }
            session.check(); await assertInstagramReady(page)
            if (await control(target, 'Unlike').isVisible() || !await like.isVisible()) return
          }
          const timeout = session.timeout(15_000), deadline = Date.now() + timeout
          await (await actionLocator(like, timeout)).hover({ timeout })
          session.check(); await assertInstagramReady(page)
          if (await control(target, 'Unlike').isVisible() || !await like.isVisible()) return
          const remaining = deadline - Date.now()
          if (remaining <= 0) throw new errors.TimeoutError('Like click timed out while moving to its target')
          // Resolve Like again after hovering; a pinned handle could now be Unlike.
          const clickOptions = { timeout: session.timeout(remaining), human_config: { scroll_target_zone: [0, 1] } }
          await like.click(clickOptions)
          await control(target, 'Unlike').waitFor({ state: 'visible', timeout: session.timeout(2000) })
          log({ event: 'automation.engagement.liked' })
        }
      } else log({ event: 'automation.engagement.action_skipped', action: 'like', reason: 'target_unavailable' })
    }
  })
  await optional('save', async () => {
    if (budget.remaining('saves')) {
      const save = control(target, 'Save')
      if (await save.isVisible() && await revealForClick(page, save, session)) {
        session.check(); await assertInstagramReady(page)
        if (budget.take('saves')) {
          await (await actionLocator(save, session.timeout(5000))).click({ timeout: session.timeout(5000) })
          log({ event: 'automation.engagement.save_attempted' })
        }
      }
    }
  })
  await optional('comments', async () => {
    if (!budget.remaining('comments')) return
    const dialogs = page.getByRole('dialog').filter({ visible: true })
    if (await dialogs.count()) {
      // Topic results already show their comment thread inside the article.
      const thread = target.locator('ul').first()
      if (await thread.isVisible() && budget.take('comments')) {
        await session.wait(random(5000, 10_000)); await scrollModal(page, thread, 1, session)
        log({ event: 'automation.engagement.comments_read' })
      }
      return
    }
    const comments = control(target, 'Comment')
    if (!await comments.isVisible() || !await revealForClick(page, comments, session)) return
    session.check(); await assertInstagramReady(page)
    if (!budget.take('comments')) return
    await (await actionLocator(comments, session.timeout(5000))).click({ timeout: session.timeout(5000) })
    try {
      const panel = dialogs.last()
      await panel.waitFor({ state: 'visible', timeout: session.timeout(8000) })
      await assertInstagramReady(page)
      await session.wait(random(5000, 10_000)); await scrollModal(page, panel, 1, session)
      log({ event: 'automation.engagement.comments_read' })
    } finally {
      // Reading only: never focus, fill or submit the comment composer.
      await page.keyboard.press('Escape').catch(() => {})
    }
  })
  await optional('profile', async () => {
    // Explore dialogs return to their grid; Home/Reels can visit this matched post's author.
    if (!budget.remaining('profiles') || session.end - Date.now() < 15_000 ||
      (!isInstagramHome(page) && !/\/reels\//.test(page.url()))) return
    if (budget.take('profiles')) await visit(page, target, log, session)
  })
}
