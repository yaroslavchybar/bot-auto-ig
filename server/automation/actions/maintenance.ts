import type { Locator, Page } from 'playwright-core'
import type { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { maintenancePostMatches, type FeedPostContext } from '../../shared/warmupTopics.js'
import { topicContentMatches, type TopicMatcher } from './topic-intent.js'
import { actionLocator } from './action-locator.js'
import { revealForClick, scrollModal } from './scroll.js'
import { assertInstagramReady } from './instagram-state.js'
import { BrowseSession } from './session.js'
import { chance, random, type ActionLogger } from './shared.js'

const control = (target: Locator, label: string) => target.locator(
  `button:has(svg[aria-label="${label}"]), [role="button"]:has(svg[aria-label="${label}"])`).first()

/** Likes and occasional extras share one daily budget; never use comment or neighboring-post controls. */
export async function maintainPost(page: Page, target: Locator,
  context: Pick<FeedPostContext, 'text' | 'relationship'>, topics: readonly string[], budget: WarmupActivityBudget,
  session: BrowseSession, log: ActionLogger, matchesTopic: TopicMatcher = topicContentMatches): Promise<void> {
  const related = context.relationship !== 'followed' && topics.length > 0 && await matchesTopic(context, topics, session, log, target)
  if (!maintenancePostMatches(context, topics, related)) return
  if (budget.remaining('likes') && chance(25) && !await target.locator('svg[aria-label="Unlike"]').count()) {
    const like = control(target, 'Like')
    if (await like.isVisible() && await revealForClick(page, like, session)) {
      session.check(); await assertInstagramReady(page)
      if (budget.take('likes')) {
        await (await actionLocator(like, session.timeout(5000))).click({ timeout: session.timeout(5000) })
        await control(target, 'Unlike').waitFor({ state: 'visible', timeout: session.timeout(2000) })
        log({ event: 'automation.maintenance.liked' })
      }
    }
  }
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
}
