import type { Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { isTransientDomIssue } from '../../shared/domErrors.js'
import type { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { warmupTopics, feedPostContext, feedPostMatches } from '../../shared/warmupTopics.js'
import { actionLocator } from './action-locator.js'
import { browseFeed } from './feed.js'
import { isUserHref } from './guards.js'
import { assertInstagramReady } from './instagram-state.js'
import { closeDialog } from './navigation.js'
import { wanderProfile } from './profiles.js'
import { openReels, watchReels } from './reels.js'
import { BrowseSession, SessionEnded } from './session.js'
import { random, type ActionLogger, type StopCheck } from './shared.js'
import { viewContent } from './viewing.js'
import { topicContentMatches, type TopicMatcher } from './topic-intent.js'
import { maintainPost } from './maintenance.js'
import { openTopicResults, searchExplore } from './explore.js'
import { smoothScroll } from './scroll.js'

export type TopicBrowseState = { feedViewed: boolean; profilesChecked: boolean; seenPosts: Set<string>; searchTerms?: readonly string[] }
export const TOPIC_SEARCH_LAST_DAY = 4

/** Use account suggestions from the named search input, visiting without engagement. */
export async function visitTopicProfiles(page: Page, topic: string, budget: WarmupActivityBudget,
  session: BrowseSession, log: ActionLogger): Promise<void> {
  if (!await searchExplore(page, topic, session)) return
  const loading = page.locator('main [role="status"]')
  if (await loading.count()) await loading.first().waitFor({ state: 'hidden', timeout: session.timeout(8_000) })
  await assertInstagramReady(page)
  const hrefs = await page.locator('main a[href]').evaluateAll(links => [...new Set(links
    .filter(link => link.textContent?.trim()).map(link => link.getAttribute('href')))])
  const candidates = hrefs.filter(isUserHref)
  const count = Math.min(budget.remaining('profiles'), 2, candidates.length)
  for (let i = 0; i < count && session.end - Date.now() > 15_000; i++) {
    session.check()
    const href = candidates.splice(Math.floor(Math.random() * candidates.length), 1)[0]!
    await page.goto(`https://www.instagram.com${href}`, { waitUntil: 'domcontentloaded', timeout: session.timeout(15_000) })
    await assertInstagramReady(page)
    await page.locator('main header').waitFor({ state: 'visible', timeout: session.timeout(8_000) })
    if (!budget.take('profiles')) break
    await wanderProfile(page, log, () => session.stopped(), session.end, session)
    log({ event: 'automation.warmup.topic_profile_visited', topic, targetUsername: href.split('/')[1] })
  }
}

/** Search through the UI, scan the grid, and return to it after each opened post. */
export async function watchTopicPosts(page: Page, topic: string, count: number, budget: WarmupActivityBudget,
  seen: Set<string>, session: BrowseSession, log: ActionLogger, maintenance = false, matchesTopic: TopicMatcher = topicContentMatches,
  topics: readonly string[], deps = { search: openTopicResults, scroll: smoothScroll }): Promise<void> {
  if (count <= 0 || budget.remaining('reels') <= 0) return
  if (!await deps.search(page, topic, session)) return
  const tiles = page.locator('main a[href*="/p/"], main a[href*="/reel/"]')
  await tiles.first().waitFor({ state: 'visible', timeout: session.timeout(10_000) }).catch(() => {})
  session.check()
  await assertInstagramReady(page)
  let watched = 0
  for (let step = 0; step < count + 15 && watched < count; step++) {
    session.check()
    const viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    const candidates: number[] = []
    const tileCount = await tiles.count()
    for (let i = 0; i < tileCount; i++) {
      session.check()
      const tile = tiles.nth(i), href = await tile.getAttribute('href', { timeout: session.timeout(1000) })
      if (!href || seen.has(href)) continue
      const box = await tile.boundingBox({ timeout: session.timeout(1000) })
      if (box && box.x + box.width > 0 && box.x < viewport.width && box.y + box.height > 0 && box.y < viewport.height)
        candidates.push(i)
    }
    if (!candidates.length) {
      await page.mouse.move(viewport.width * 0.6, viewport.height * 0.6)
      await deps.scroll(page, viewport.height * random(0.5, 0.8), session)
      await session.wait(random(700, 1500))
      continue
    }
    const tile = tiles.nth(candidates[Math.floor(Math.random() * candidates.length)]!)
    const href = await tile.getAttribute('href', { timeout: session.timeout(1000) })
    if (!href) continue
    await (await actionLocator(tile, session.timeout(20_000))).click({ timeout: session.timeout(20_000) })
    try {
      const dialog = page.getByRole('dialog').filter({ visible: true }).first()
      const article = dialog.getByRole('article')
      await article.waitFor({ state: 'visible', timeout: session.timeout(10_000) })
      session.check()
      await assertInstagramReady(page)
      // The clicked post can use a different route than its grid tile.
      const path = new URL(page.url()).pathname
      const previouslySeen = seen.has(path)
      seen.add(href)
      seen.add(path)
      const sponsored = await article.getByText(/^(?:Sponsored|Ad)$/i).count() > 0
      if (!previouslySeen && !sponsored) {
        const context = await article.evaluate(feedPostContext)
        const related = context.relationship === 'not-followed' && topics.length > 0 && await matchesTopic(context, topics, session, log, article)
        if (feedPostMatches(context, topics, related)) {
          const hasVideo = await article.locator('video').count() > 0
          if (hasVideo && !budget.take('reels')) break
          const viewed = await viewContent(article, (Math.random() > 0.85 ? random(18, 35) : random(6, 16)) * 1000, session)
          if (viewed) { watched++; budget.browsed++ }
          if (viewed && maintenance) {
            await maintainPost(page, article, context, topics, budget, session, log, matchesTopic)
          }
        }
      }
    } finally {
      if (!session.stopped()) await closeDialog(page, session)
      else await page.keyboard.press('Escape').catch(() => {})
    }
    if (watched < count) {
      await page.mouse.move(viewport.width * 0.6, viewport.height * 0.6)
      await deps.scroll(page, viewport.height * random(0.5, 0.8), session)
      await session.wait(random(700, 1500))
    }
  }
  log({ event: 'automation.warmup.topic_results_watched', topic, watchedCount: watched })
}

const dependencies = { feed: browseFeed, profiles: visitTopicProfiles, topic: watchTopicPosts,
  openReels, reels: watchReels, now: Date.now, random }

/** Browse enabled surfaces within one deadline; never fall back to a disabled surface. */
export async function browseTopics(page: Page, end: number, config: Record<string, unknown>,
  budget: WarmupActivityBudget, state: TopicBrowseState, log: ActionLogger, stopped: StopCheck,
  deps = dependencies): Promise<'finished' | 'stopped' | 'stalled'> {
  const session = new BrowseSession(end, stopped)
  const topics = warmupTopics(config.warmup_topics)
  const homeFeed = config.browse_home_feed !== false
  const reels = config.scroll_reels !== false
  if (!homeFeed && !reels) return stopped() ? 'stopped' : 'finished'
  const earlySearch = Number(config.warmup_day ?? 1) <= TOPIC_SEARCH_LAST_DAY
  if ((!topics.length || !earlySearch) && homeFeed)
    return deps.feed(page, Math.max(0, end - deps.now()) / 60_000, config, log, stopped, budget)
  const searchTerms = state.searchTerms ?? []
  const topic = earlySearch && topics.length && searchTerms.length ? searchTerms[Math.floor(deps.random(0, searchTerms.length))]! : ''
  const started = deps.now()
  const bounded = async (action: () => Promise<void>) => {
    try { await action() }
    catch (error) {
      if (error instanceof SessionEnded) {
        if (session.stopped()) throw error
        return
      }
      if (!(error instanceof errors.TimeoutError) && !isTransientDomIssue(error)) throw error
      session.check()
      await assertInstagramReady(page)
      log({ event: 'automation.warmup.topic_browsing_unavailable', error, outcome: 'skipped' })
    }
  }
  try {
    if (homeFeed && !state.feedViewed) {
      state.feedViewed = true
      await deps.feed(page, Math.min(deps.random(40, 120), (end - started) / 1000 * 0.15) / 60,
        { ...config, own_profile_chance: 0, dm_chance: 0, reels_chance: 0, profile_visit_chance: 0,
          skip_post_chance: 30 }, log, stopped, budget)
    }
    if (topic && !state.profilesChecked && end - deps.now() > 60_000 && budget.remaining('profiles') > 0) {
      state.profilesChecked = true
      await bounded(() => deps.profiles(page, topic, budget, new BrowseSession(Math.min(end, deps.now() + (end - deps.now()) * 0.25), stopped), log))
    }
    const topicEnd = deps.now() + Math.max(0, end - deps.now()) * 0.7
    if (reels && topic && budget.remaining('reels') > 0 && topicEnd - deps.now() > 5000)
      await bounded(() => deps.topic(page, topic, Math.min(budget.remaining('reels'), Math.ceil(budget.plan.reels * 0.7)),
        budget, state.seenPosts, new BrowseSession(topicEnd, stopped), log, Number(config.warmup_day ?? 1) >= 8,
        topicContentMatches, topics))
    if (reels && end - deps.now() > 10_000 && budget.remaining('reels') > 0 && !stopped()) {
      if (await deps.openReels(page, log, session))
        await deps.reels(page, budget.remaining('reels'), config, log, stopped, end, session, budget)
    }
    // If results are empty or today's reel limit is reached, spend the remaining time browsing.
    if (homeFeed && end > deps.now() && !stopped())
      return deps.feed(page, (end - deps.now()) / 60_000,
        { ...config, reels_chance: 0 }, log, stopped, budget)
    return stopped() ? 'stopped' : 'finished'
  } catch (error) {
    if (!(error instanceof SessionEnded)) throw error
    return stopped() ? 'stopped' : 'finished'
  }
}
