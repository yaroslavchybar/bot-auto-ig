import type { Locator, Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { isTransientDomIssue } from '../../shared/domErrors.js'
import type { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { maintenancePostMatches, type FeedPostContext } from '../../shared/warmupTopics.js'
import { topicContentMatches, type TopicMatcher } from './topic-intent.js'
import { actionLocator } from './action-locator.js'
import { revealForClick, scrollModal } from './scroll.js'
import { assertInstagramReady } from './instagram-state.js'
import { BrowseSession, SessionEnded } from './session.js'
import { chance, random, type ActionLogger } from './shared.js'

const control = (target: Locator, label: string) => target.locator(
  `button:has(svg[aria-label="${label}"]), [role="button"]:has(svg[aria-label="${label}"])`).first()

/** Likes and occasional extras share one daily budget; never use comment or neighboring-post controls. */
export async function maintainPost(page: Page, target: Locator,
  context: Pick<FeedPostContext, 'text' | 'relationship'>, topics: readonly string[], budget: WarmupActivityBudget,
  session: BrowseSession, log: ActionLogger, matchesTopic: TopicMatcher = topicContentMatches, likeSurface?: Locator): Promise<void> {
  const related = context.relationship !== 'followed' && topics.length > 0 && await matchesTopic(context, topics, session, log, target)
  if (!maintenancePostMatches(context, topics, related)) return
  const optional = async (action: string, perform: () => Promise<void>) => {
    try { await perform() }
    catch (error) {
      if (error instanceof SessionEnded) throw error
      session.check()
      await assertInstagramReady(page)
      if (!(error instanceof errors.TimeoutError) && !isTransientDomIssue(error)) throw error
      log({ event: 'automation.maintenance.action_skipped', action, error })
    }
  }
  await optional('like', async () => {
    if (budget.remaining('likes') && chance(25) && !await target.locator('svg[aria-label="Unlike"]').count()) {
      const like = control(target, 'Like')
      const surface = likeSurface ?? like
      if (await surface.isVisible() && await revealForClick(page, surface, session)) {
        session.check(); await assertInstagramReady(page)
        if (budget.take('likes')) {
          if (likeSurface) {
            await (await actionLocator(surface, session.timeout(15_000))).dblclick({ timeout: session.timeout(15_000) })
            // Some web Reels layouts only toggle playback on double-click. Confirm before falling back.
            const liked = await control(target, 'Unlike').waitFor({ state: 'visible', timeout: session.timeout(2000) })
              .then(() => true, error => { if (error instanceof errors.TimeoutError) return false; throw error })
            if (liked) { log({ event: 'automation.maintenance.liked', method: 'double_tap' }); return }
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
          log({ event: 'automation.maintenance.liked' })
        }
      }
    }
  })
  await optional('save', async () => {
    if (budget.remaining('saves') && chance(10)) {
      const save = control(target, 'Save')
      if (await save.isVisible() && await revealForClick(page, save, session)) {
        session.check(); await assertInstagramReady(page)
        if (budget.take('saves')) {
          await (await actionLocator(save, session.timeout(5000))).click({ timeout: session.timeout(5000) })
          log({ event: 'automation.maintenance.save_attempted' })
        }
      }
    }
  })
  await optional('comments', async () => {
    if (!budget.remaining('comments') || !chance(20)) return
    const dialogs = page.getByRole('dialog').filter({ visible: true })
    if (await dialogs.count()) {
      // Topic results already show their comment thread inside the article.
      const thread = target.locator('ul').first()
      if (await thread.isVisible() && budget.take('comments')) {
        await session.wait(random(5000, 10_000)); await scrollModal(page, thread, 1, session)
        log({ event: 'automation.maintenance.comments_read' })
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
      log({ event: 'automation.maintenance.comments_read' })
    } finally {
      // Reading only: never focus, fill or submit the comment composer.
      await page.keyboard.press('Escape').catch(() => {})
    }
  })
}
