import type { Locator, Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { UnsupportedHumanizeSelectorError } from 'cloakbrowser/human'
import type { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { engagementMatches, feedPostContext, type FeedPostContext } from '../../shared/warmupTopics.js'
import { topicContentMatches, type TopicMatcher } from './topic-intent.js'
import { actionLocator } from './action-locator.js'
import { revealForClick, scrollModal } from './scroll.js'
import { assertInstagramReady } from './instagram-state.js'
import { BrowseSession, SessionEnded } from './session.js'
import { visitAuthorProfile } from './profiles.js'
import { isInstagramHome } from './navigation.js'
import { chance, random, type ActionLogger } from './shared.js'
import { isTemporaryUiError } from './ui-errors.js'
import { readPostComments } from './comments.js'

const control = (target: Locator, label: string) => target.locator(
  `button:has(svg[aria-label="${label}"]), [role="button"]:has(svg[aria-label="${label}"])`).first()

/** Aim at the heart itself; this selector stops matching if Like becomes Unlike. */
export function liveLikeSelector(button: Element): string {
  if (!button.isConnected) throw new Error('Action target is detached or missing')
  const icon = button.querySelector('svg[aria-label="Like"]')
  if (!icon) throw new Error('Action target is detached or missing')
  const marker = `igbot-${button.ownerDocument.defaultView!.crypto.randomUUID()}`
  icon.setAttribute('data-igbot-like-target', marker)
  return `svg[data-igbot-like-target=${marker}][aria-label=Like]`
}

/** Shared Like input only; callers provide their own eligibility decision. */
export async function likePost(page: Page, target: Locator, budget: WarmupActivityBudget | undefined,
  session: BrowseSession, log: ActionLogger, likeChance = 30, checkTarget?: () => Promise<void>): Promise<void> {
  if ((!budget || budget.remaining('likes')) && !await target.locator('svg[aria-label="Unlike"]').count()) {
    if (likeChance < 100 && !chance(likeChance)) return
    const like = control(target, 'Like')
    const icon = like.locator('svg[aria-label="Like"]').first()
    if (await like.isVisible() && await revealForClick(page, icon, session)) {
      session.check(); await assertInstagramReady(page)
      await checkTarget?.()
      if (!budget || budget.take('likes')) {
        const timeout = session.timeout(15_000), deadline = Date.now() + timeout
        const humanConfig = { scroll_target_zone: [0, 1], mouse_overshoot_chance: 0 }
        const hoverOptions = { timeout, human_config: humanConfig }
        await (await actionLocator(icon, timeout)).hover(hoverOptions)
        session.check(); await assertInstagramReady(page)
        await checkTarget?.()
        if (await control(target, 'Unlike').isVisible() || !await like.isVisible()) return
        // Resolve a fresh Like through one CSS selector; Cloak rejects the original chained locator.
        const selector = await like.evaluate(liveLikeSelector, undefined, { timeout: session.timeout(Math.max(1, deadline - Date.now())) })
        try {
          const remaining = deadline - Date.now()
          if (remaining <= 0) throw new errors.TimeoutError('Like click timed out while moving to its target')
          // The temporary marker survives unrelated DOM changes, but still requires Like.
          const clickOptions = { timeout: session.timeout(remaining), human_config: humanConfig }
          await page.locator(selector).click(clickOptions)
        } finally {
          await page.locator(selector.replace('[aria-label=Like]', '')).evaluateAll(icons => {
            for (const icon of icons) icon.removeAttribute('data-igbot-like-target')
          }).catch(() => {})
        }
        await control(target, 'Unlike').waitFor({ state: 'visible', timeout: session.timeout(2000) })
        log({ event: 'automation.engagement.liked', method: 'like_button' })
      }
    } else log({ event: 'automation.engagement.action_skipped', action: 'like', reason: 'target_unavailable' })
  }
}

/** Likes and occasional extras share one daily budget; never use comment or neighboring-post controls. */
export async function engagePost(page: Page, target: Locator,
  context: Pick<FeedPostContext, 'text' | 'relationship'>, topics: readonly string[], budget: WarmupActivityBudget,
  session: BrowseSession, log: ActionLogger, matchesTopic: TopicMatcher = topicContentMatches,
  visit: typeof visitAuthorProfile = visitAuthorProfile, likeOnly = false): Promise<void> {
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
  await optional('like', () => likePost(page, target, budget, session, log))
  if (likeOnly) return
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
    if (session.end - Date.now() < 8000) return
    const comments = control(target, 'Comment')
    if (!await comments.isVisible() || !await revealForClick(page, comments, session)) return
    session.check(); await assertInstagramReady(page)
    if (!budget.take('comments')) return
    try {
      await readPostComments(page, comments, session)
      log({ event: 'automation.engagement.comments_read' })
    } catch (error) {
      if (!(error instanceof SessionEnded) || session.stopped()) throw error
      log({ event: 'automation.engagement.action_skipped', action: 'comments', reason: 'reading_time_used' })
    }
  })
  await optional('profile', async () => {
    // Explore dialogs return to their grid; Home/Reels can visit this matched post's author.
    if (!budget.remaining('profiles') || session.end - Date.now() < 30_000 ||
      (!isInstagramHome(page) && !/\/reels\//.test(page.url()))) return
    if (budget.take('profiles')) await visit(page, target, log, session, undefined, async (article, visiting) => {
      budget.browsed++; budget.used.reels++
      const context = await article.evaluate(feedPostContext)
      await engagePost(page, article, context, topics, budget, visiting, log, matchesTopic, visit, true)
    })
  })
}
