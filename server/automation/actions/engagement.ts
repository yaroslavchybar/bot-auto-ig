import type { Locator, Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { UnsupportedHumanizeSelectorError } from 'cloakbrowser/human'
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
import { isTemporaryUiError } from './ui-errors.js'

const control = (target: Locator, label: string) => target.locator(
  `button:has(svg[aria-label="${label}"]), [role="button"]:has(svg[aria-label="${label}"])`).first()

/** A single CSS selector works with Cloak and stops matching if Like becomes Unlike. */
export function liveLikeSelector(button: Element): string {
  if (!button.isConnected) throw new Error('Action target is detached or missing')
  const path: string[] = []
  for (let node: Element | null = button; node; node = node.parentElement) {
    let index = 1
    for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) index++
    path.unshift(`${node.localName}:nth-child(${index})`)
  }
  return `${path.join(' > ')}:has(svg[aria-label="Like"])`
}

/** Likes and occasional extras share one daily budget; never use comment or neighboring-post controls. */
export async function engagePost(page: Page, target: Locator,
  context: Pick<FeedPostContext, 'text' | 'relationship'>, topics: readonly string[], budget: WarmupActivityBudget,
  session: BrowseSession, log: ActionLogger, matchesTopic: TopicMatcher = topicContentMatches,
  visit: typeof visitAuthorProfile = visitAuthorProfile): Promise<void> {
  const related = topics.length > 0 && await matchesTopic(context, topics, session, log, target)
  if (!engagementMatches(context, topics, related)) return
  const optional = async (action: string, perform: () => Promise<void>) => {
    try { await perform() }
    catch (error) {
      if (error instanceof SessionEnded) throw error
      session.check()
      await assertInstagramReady(page)
      if (!isTemporaryUiError(error) && !(error instanceof UnsupportedHumanizeSelectorError)) throw error
      log({ event: 'automation.engagement.action_skipped', action, error })
    }
  }
  await optional('like', async () => {
    if (budget.remaining('likes') && !await target.locator('svg[aria-label="Unlike"]').count()) {
      const like = control(target, 'Like')
      if (await like.isVisible() && await revealForClick(page, like, session)) {
        session.check(); await assertInstagramReady(page)
        if (budget.take('likes')) {
          const timeout = session.timeout(15_000), deadline = Date.now() + timeout
          await (await actionLocator(like, timeout)).hover({ timeout })
          session.check(); await assertInstagramReady(page)
          if (await control(target, 'Unlike').isVisible() || !await like.isVisible()) return
          // Resolve a fresh Like through one CSS selector; Cloak rejects the original chained locator.
          const selector = await like.evaluate(liveLikeSelector, undefined, { timeout: session.timeout(Math.max(1, deadline - Date.now())) })
          const remaining = deadline - Date.now()
          if (remaining <= 0) throw new errors.TimeoutError('Like click timed out while moving to its target')
          // Resolve Like again after hovering; a pinned handle could now be Unlike.
          const clickOptions = { timeout: session.timeout(remaining), human_config: { scroll_target_zone: [0, 1] } }
          await page.locator(selector).click(clickOptions)
          await control(target, 'Unlike').waitFor({ state: 'visible', timeout: session.timeout(2000) })
          log({ event: 'automation.engagement.liked', method: 'like_button' })
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
