import type { Page } from 'playwright-core'
import { warmupBeginFollow, warmupConfirmFollow, warmupPauseFollows, type WarmupFollowRequest } from '../../shared/convexClient.js'
import { warmupTopics } from '../../shared/warmupTopics.js'
import type { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { followButton, profileControls } from '../follow.js'
import { likeRecentPost, ownUsername } from '../follow-back.js'
import { actionLocator, clickAction } from './action-locator.js'
import { isUserHref } from './guards.js'
import { assertInstagramReady } from './instagram-state.js'
import { BrowseSession } from './session.js'
import { random, type ActionLogger } from './shared.js'
import { topicContentMatches, type TopicMatcher } from './topic-intent.js'
import { performProfileFollow } from './follow-safety.js'

const dependencies = { beginFollow: warmupBeginFollow, confirmFollow: warmupConfirmFollow, like: likeRecentPost, ownUsername,
  follow: performProfileFollow, pauseFollows: warmupPauseFollows, topic: topicContentMatches }

/** Week-one engagement visits topic search accounts; missing topic evidence always blocks engagement. */
export async function engageWeekOne(page: Page, keywords: string, budget: WarmupActivityBudget,
  session: BrowseSession, request: Omit<WarmupFollowRequest, 'username'>, log: ActionLogger, deps: Omit<typeof dependencies, 'topic'> & { topic?: TopicMatcher } = dependencies,
  interlude?: () => Promise<boolean>, searchTerms: readonly string[] = []): Promise<void> {
  const topics = warmupTopics(keywords)
  const matchesTopic = deps.topic ?? topicContentMatches
  if (!topics.length || !searchTerms.length || !budget.remaining('profiles') || (!budget.remaining('likes') && !budget.remaining('follows'))) return
  session.check()
  const own = (await deps.ownUsername(page)).toLowerCase()
  const search = page.locator('a:has(svg[aria-label="Search"])').filter({ visible: true }).first()
  if (!await search.isVisible()) return
  await (await actionLocator(search, session.timeout(5000))).click({ timeout: session.timeout(5000) })
  const input = page.getByRole('textbox', { name: 'Search input', exact: true })
  await input.waitFor({ state: 'visible', timeout: session.timeout(10_000) })
  await (await actionLocator(input, session.timeout(5000))).fill(searchTerms[Math.floor(Math.random() * searchTerms.length)], { timeout: session.timeout(5000) })
  await session.wait(random(2500, 4000))
  await assertInstagramReady(page)
  const hrefs = await page.locator('main a[href]').evaluateAll(links => [...new Set(links
    .filter(link => link.textContent?.trim()).map(link => link.getAttribute('href')))].filter(href => href !== null))
  const candidates = hrefs.filter(isUserHref).filter(href => href.split('/')[1].toLowerCase() !== own).slice(0, 20)
  const allowed = async () => { session.check(); await assertInstagramReady(page); session.check(); return true }
  let needsInterlude = false
  while (candidates.length && !session.stopped() && budget.remaining('profiles') && (budget.remaining('likes') || budget.remaining('follows'))) {
    if (needsInterlude && (!interlude || !await interlude())) break
    needsInterlude = false
    if (!budget.take('profiles')) break
    const href = candidates.splice(Math.floor(Math.random() * candidates.length), 1)[0]
    await page.goto(`https://www.instagram.com${href}`, { waitUntil: 'domcontentloaded', timeout: session.timeout(15_000) })
    const header = profileControls(page)
    await header.waitFor({ state: 'visible', timeout: session.timeout(10_000) })
    await allowed()
    const text = await header.innerText()
    if (!await matchesTopic({ text, relationship: 'not-followed' }, topics, session, log, page.locator('main'))) {
      log({ event: 'automation.warmup.account_off_topic', targetUsername: href.split('/')[1] })
      continue
    }
    await session.wait(random(2000, 4000))
    if (budget.remaining('likes')) {
      const liked = await deps.like(page, allowed, async () => {
        session.check()
        const post = page.getByRole('dialog').getByRole('article')
        const text = await post.innerText()
        return await matchesTopic({ text, relationship: 'not-followed' }, topics, session, log, post) && budget.take('likes')
      })
      if (liked) log({ event: 'automation.warmup.topic_like', targetUsername: href.split('/')[1] })
    }
    if (!budget.remaining('follows') || !await followButton(page).isVisible()) continue
    await allowed()
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
