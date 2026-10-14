import type { Page } from 'playwright-core'
import { isTemporaryUiError } from './ui-errors.js'
import { warmupBeginFollow, warmupConfirmFollow, warmupPauseFollows, type WarmupFollowRequest } from '../../shared/convexClient.js'
import { warmupTopics } from '../../shared/warmupTopics.js'
import type { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { followButton, profileControls } from '../follow.js'
import { ownUsername } from '../follow-back.js'
import { clickAction } from './action-locator.js'
import { isUserHref } from './guards.js'
import { assertInstagramReady } from './instagram-state.js'
import { BrowseSession } from './session.js'
import { random, type ActionLogger } from './shared.js'
import { topicContentMatches, type TopicMatcher } from './topic-intent.js'
import { performProfileFollow } from './follow-safety.js'
import { searchExplore } from './explore.js'

const dependencies = { beginFollow: warmupBeginFollow, confirmFollow: warmupConfirmFollow, ownUsername,
  follow: performProfileFollow, pauseFollows: warmupPauseFollows, topic: topicContentMatches, search: searchExplore }

/** Topic follows use verified interest evidence and the shared daily follow allowance. */
export async function followTopicAccounts(page: Page, interests: string | readonly string[], budget: WarmupActivityBudget,
  session: BrowseSession, request: Omit<WarmupFollowRequest, 'username'>, log: ActionLogger, deps: Omit<typeof dependencies, 'topic'> & { topic?: TopicMatcher } = dependencies,
  interlude?: () => Promise<boolean>, searchTerms: readonly string[] = []): Promise<void> {
  const topics = warmupTopics(interests)
  const matchesTopic = deps.topic ?? topicContentMatches
  if (!topics.length || !searchTerms.length || !budget.remaining('profiles') || !budget.remaining('follows')) return
  session.check()
  const recover = async (error: unknown, action: string) => {
    session.check()
    if (!isTemporaryUiError(error)) throw error
    await assertInstagramReady(page, session)
    log({ event: 'automation.warmup.engagement_skipped', action, error })
  }
  let candidates: string[]
  try {
    const own = (await deps.ownUsername(page)).toLowerCase()
    if (!await deps.search(page, searchTerms[Math.floor(Math.random() * searchTerms.length)], session)) return
    await assertInstagramReady(page)
    const hrefs = await page.locator('main a[href]').evaluateAll(links => [...new Set(links
      .filter(link => link.textContent?.trim()).map(link => link.getAttribute('href')))].filter(href => href !== null))
    candidates = hrefs.filter(isUserHref).filter(href => href.split('/')[1].toLowerCase() !== own).slice(0, 20)
  } catch (error) { await recover(error, 'search'); return }
  const allowed = async () => { session.check(); await assertInstagramReady(page); session.check(); return true }
  let needsInterlude = false
  while (candidates.length && !session.stopped() && budget.remaining('profiles') && budget.remaining('follows')) {
    if (needsInterlude && (!interlude || !await interlude())) break
    needsInterlude = false
    if (!budget.take('profiles')) break
    const href = candidates.splice(Math.floor(Math.random() * candidates.length), 1)[0]
    try {
      await page.goto(`https://www.instagram.com${href}`, { waitUntil: 'domcontentloaded', timeout: session.timeout(15_000) })
      const header = profileControls(page)
      await header.waitFor({ state: 'visible', timeout: session.timeout(10_000) })
      await allowed()
      const text = await header.innerText()
      if (!await matchesTopic({ text, relationship: 'not-followed' }, topics, session, log, page.locator('main'))) {
        log({ event: 'automation.warmup.account_off_topic', targetUsername: href.split('/')[1] })
        continue
      }
    } catch (error) { await recover(error, 'profile'); continue }
    await session.wait(random(2000, 4000))
    if (!budget.remaining('follows')) continue
    try {
      if (!await followButton(page).isVisible()) continue
      await allowed()
    } catch (error) { await recover(error, 'follow_control'); continue }
    const followRequest = { ...request, username: href.split('/')[1] }
    if (!await deps.beginFollow(followRequest)) continue
    budget.take('follows')
    await allowed()
    const followed = await deps.follow(page, allowed,
      () => clickAction(followButton(page), session.timeout(10_000)),
      () => deps.confirmFollow(followRequest).then(() => {}), async reason => {
        budget.plan.follows = budget.used.follows
        log({ event: 'automation.follow_paused', reason })
        await deps.pauseFollows(request.profileId, request.date, reason)
      }, session.timeout(15_000))
    if (followed) {
      needsInterlude = true
      log({ event: 'automation.warmup.topic_follow', targetUsername: followRequest.username })
    }
    await session.wait(random(4000, 8000))
  }
}
