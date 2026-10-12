import type { Page } from 'playwright-core'
import type { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { warmupTopics, feedPostContext } from '../../shared/warmupTopics.js'
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
import { maintainPost } from './maintenance.js'

export type TopicBrowseState = { feedViewed: boolean; profilesChecked: boolean; seenPosts: Set<string> }
export const topicGridUrl = (topic: string) => `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(topic)}`
// Carousel slides have another Next inside article; the result navigator is outside it.
export const TOPIC_NEXT_RESULT = 'xpath=.//*[self::button or @role="button"][not(ancestor::article)][@aria-label="Next" or .//*[@aria-label="Next"] or normalize-space(.)="Next"]'

/** Use account suggestions from the named search input, visiting without engagement. */
export async function visitTopicProfiles(page: Page, topic: string, budget: WarmupActivityBudget,
  session: BrowseSession, log: ActionLogger): Promise<void> {
  const search = page.locator('a:has(svg[aria-label="Search"])').filter({ visible: true }).first()
  if (!await search.isVisible()) return
  await (await actionLocator(search, session.timeout(5_000))).click({ timeout: session.timeout(5_000) })
  const input = page.getByRole('textbox', { name: 'Search input', exact: true })
  await input.waitFor({ state: 'visible', timeout: session.timeout(10_000) })
  await (await actionLocator(input, session.timeout(5_000))).fill(topic, { timeout: session.timeout(5_000) })
  await session.wait(random(2500, 4000))
  const loading = page.locator('main [role="status"]')
  if (await loading.count()) await loading.first().waitFor({ state: 'hidden', timeout: session.timeout(8_000) })
  await assertInstagramReady(page)
  const hrefs = await page.locator('main a[href]').evaluateAll(links => [...new Set(links
    .filter(link => link.textContent?.trim()).map(link => link.getAttribute('href')))])
  const candidates = hrefs.filter(isUserHref)
  const count = Math.min(budget.remaining('profiles'), 2, candidates.length)
  for (let i = 0; i < count && session.end - Date.now() > 15_000; i++) {
    session.check()
    if (!budget.take('profiles')) break
    const href = candidates.splice(Math.floor(Math.random() * candidates.length), 1)[0]!
    await page.goto(`https://www.instagram.com${href}`, { waitUntil: 'domcontentloaded', timeout: session.timeout(15_000) })
    await assertInstagramReady(page)
    await page.locator('main header').waitFor({ state: 'visible', timeout: session.timeout(8_000) })
    await wanderProfile(page, log, () => session.stopped(), session.end, session)
    log({ event: 'automation.warmup.topic_profile_visited', topic, targetUsername: href.split('/')[1] })
  }
}

/** Keyword grid opens a post dialog; its Next control advances the search results. */
export async function watchTopicPosts(page: Page, topic: string, count: number, budget: WarmupActivityBudget,
  seen: Set<string>, session: BrowseSession, log: ActionLogger, maintenance = false): Promise<void> {
  if (count <= 0 || budget.remaining('reels') <= 0) return
  await page.goto(topicGridUrl(topic), { waitUntil: 'domcontentloaded', timeout: session.timeout(15_000) })
  const tiles = page.locator('main a[href*="/p/"], main a[href*="/reel/"]')
  await tiles.first().waitFor({ state: 'visible', timeout: session.timeout(10_000) }).catch(() => {})
  session.check()
  await assertInstagramReady(page)
  let opened = false
  const total = Math.min(await tiles.count(), 24)
  const order = Array.from({ length: total }, (_, i) => i)
  // Draw without replacement instead of a random sort comparator.
  while (order.length) {
    const index = order.splice(Math.floor(Math.random() * order.length), 1)[0]!
    const tile = tiles.nth(index)
    const href = await tile.getAttribute('href')
    if (!href || seen.has(href) || !await tile.isVisible()) continue
    await (await actionLocator(tile, session.timeout(5_000))).click({ timeout: session.timeout(5_000) })
    opened = true
    break
  }
  if (!opened) return
  try {
    const dialog = page.getByRole('dialog').filter({ visible: true }).first()
    const article = dialog.getByRole('article')
    await article.waitFor({ state: 'visible', timeout: session.timeout(10_000) })
    let watched = 0
    for (let step = 0; step < count + 15 && watched < count; step++) {
      session.check()
      await assertInstagramReady(page)
      // The URL changes on Next; use the post id to avoid repeats across browsing chunks.
      const path = new URL(page.url()).pathname
      const sponsored = await article.getByText(/^(?:Sponsored|Ad)$/i).count() > 0
      if (!seen.has(path) && !sponsored) {
        seen.add(path)
        const hasVideo = await article.locator('video').count() > 0
        if (hasVideo && !budget.take('reels')) break
        const viewed = await viewContent(article, (Math.random() > 0.85 ? random(18, 35) : random(6, 16)) * 1000, session)
        if (viewed && maintenance) {
          const context = await article.evaluate(feedPostContext)
          await maintainPost(page, article, context, [topic], budget, session, log)
        }
        if (viewed) { watched++; budget.browsed++ }
      }
      if (watched >= count) break
      const next = dialog.locator(TOPIC_NEXT_RESULT)
      if (!await next.isVisible()) break
      const previous = page.url()
      await (await actionLocator(next, session.timeout(5_000))).click({ timeout: session.timeout(5_000) })
      await page.waitForURL(url => url.href !== previous, { timeout: session.timeout(5_000) })
      await session.wait(random(700, 1500))
    }
    log({ event: 'automation.warmup.topic_results_watched', topic, watchedCount: watched })
  } finally {
    if (!session.stopped()) await closeDialog(page, session)
    else await page.keyboard.press('Escape').catch(() => {})
  }
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
  if (!topics.length && homeFeed)
    return deps.feed(page, Math.max(0, end - deps.now()) / 60_000, config, log, stopped, budget)
  const topic = topics.length ? topics[Math.floor(deps.random(0, topics.length))]! : ''
  const started = deps.now()
  const bounded = async (action: () => Promise<void>) => {
    try { await action() }
    catch (error) { if (!(error instanceof SessionEnded) || session.stopped()) throw error }
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
        budget, state.seenPosts, new BrowseSession(topicEnd, stopped), log, Number(config.warmup_day ?? 1) >= 8))
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
