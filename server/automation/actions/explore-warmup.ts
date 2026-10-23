import type { Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { isTransientDomIssue } from '../../shared/domErrors.js'
import type { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { warmupTopics, feedPostContext } from '../../shared/warmupTopics.js'
import { actionLocator } from './action-locator.js'
import { assertInstagramReady } from './instagram-state.js'
import { closeDialog } from './navigation.js'
import { BrowseSession, SessionEnded } from './session.js'
import { random, type ActionLogger, type StopCheck } from './shared.js'
import { viewContent } from './viewing.js'
import { topicContentMatches, type TopicMatcher } from './topic-intent.js'
import { engagePost } from './engagement.js'
import { openTopicResults } from './explore.js'
import { quickScroll, smoothScroll } from './scroll.js'
import { topicSearchTerms } from './topic-search.js'
import { gridRow } from './post-grid.js'
import { EXPLORE_TILE_SELECTOR, matchExploreGrid, readExploreTiles } from './explore-grid.js'

export const EXPLORE_WARMUP_LAST_DAY = 4

/** Search through the UI, scan the grid, and return to it after each opened post. */
export async function watchTopicPosts(page: Page, topic: string, budget: WarmupActivityBudget,
  seen: Set<string>, session: BrowseSession, log: ActionLogger, maintenance = false, matchesTopic: TopicMatcher = topicContentMatches,
  topics: readonly string[], deps: { search: typeof openTopicResults; scroll: typeof smoothScroll; skip?: typeof quickScroll; grid?: typeof matchExploreGrid } = {
    search: openTopicResults, scroll: smoothScroll, skip: quickScroll, grid: matchExploreGrid,
  }): Promise<void> {
  if (!await deps.search(page, topic, session)) return
  const tiles = page.locator(EXPLORE_TILE_SELECTOR)
  await tiles.first().waitFor({ state: 'visible', timeout: session.timeout(10_000) }).catch(() => {})
  session.check()
  await assertInstagramReady(page)
  let watched = 0
  const inspected = new Map<string, boolean>()
  while (!session.stopped()) {
    session.check()
    const viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    const visible = (await readExploreTiles(page)).filter(tile => !seen.has(tile.href))
    const row = gridRow(visible, viewport)
    const unknown = row.filter(tile => !inspected.has(tile.href))
    if (unknown.length) {
      const selected = await (deps.grid ?? matchExploreGrid)(page, unknown, topics, session, log)
      for (const tile of unknown) inspected.set(tile.href, selected.includes(tile.href))
    }
    session.check()
    const candidates = row.filter(tile => inspected.get(tile.href))
    if (!candidates.length) {
      await page.mouse.move(viewport.width * 0.6, viewport.height * 0.6)
      if (row.length) await (deps.skip ?? quickScroll)(page, viewport.height * random(0.5, 0.8), session)
      else {
        await deps.scroll(page, viewport.height * random(0.5, 0.8), session)
        await session.wait(random(700, 1500))
      }
      continue
    }
    const href = candidates[Math.floor(Math.random() * candidates.length)]!.href
    const tile = page.locator(`main a[href=${JSON.stringify(href)}]`).first()
    // The model's tile number resolves to its original exact href after asynchronous classification.
    const box = await tile.boundingBox({ timeout: session.timeout(1000) })
    if (!box || !gridRow([{ href, box }], viewport).length) continue
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
        const related = topics.length > 0 && await matchesTopic(context, topics, session, log, article)
        if (related) {
          const hasVideo = await article.locator('video').count() > 0
          const viewed = await viewContent(article, (Math.random() > 0.85 ? random(18, 35) : random(6, 16)) * 1000, session)
          if (viewed) { watched++; budget.browsed++; if (hasVideo) budget.used.reels++ }
          if (viewed && maintenance) {
            await engagePost(page, article, context, topics, budget, session, log, matchesTopic)
          }
        }
      }
    } finally {
      if (!session.stopped()) await closeDialog(page, session)
      else await page.keyboard.press('Escape').catch(() => {})
    }
    // Process the other matches from this row before scrolling into another row.
  }
  log({ event: 'automation.warmup.topic_results_watched', topic, watchedCount: watched })
}

const dependencies = { terms: topicSearchTerms, posts: watchTopicPosts, now: Date.now, random }

/** Seed recommendations through Explore before the shared browsing flow, only on days 1–4. */
export async function runExploreWarmup(page: Page, end: number, config: Record<string, unknown>,
  budget: WarmupActivityBudget, log: ActionLogger, stopped: StopCheck, deps = dependencies): Promise<void> {
  const topics = warmupTopics(config.warmup_topics)
  if (!topics.length || Number(config.warmup_day ?? 1) > EXPLORE_WARMUP_LAST_DAY ||
    (config.browse_home_feed === false && config.scroll_reels === false) || stopped() || deps.now() >= end) return
  const session = new BrowseSession(end, stopped)
  try {
    const terms = await deps.terms(topics, session, log)
    session.check()
    if (!terms.length) return
    const query = terms[Math.floor(deps.random(0, terms.length))]!
    await deps.posts(page, query, budget, new Set(), session, log,
      Number(config.warmup_day ?? 1) >= 2, topicContentMatches, topics)
  } catch (error) {
    if (error instanceof SessionEnded || session.stopped()) return
    if (!(error instanceof errors.TimeoutError) && !isTransientDomIssue(error)) throw error
    session.check()
    await assertInstagramReady(page, session)
    log({ event: 'automation.warmup.explore_unavailable', error, outcome: 'skipped' })
  }
}
