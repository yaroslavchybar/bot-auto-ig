import { visibleActionGeometry } from './action-locator.test-support.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { ElementNotVisibleError } from 'cloakbrowser/human'
import { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { browseTopics, watchTopicPosts, topicGridUrl, TOPIC_NEXT_RESULT, type TopicBrowseState } from './topic-browsing.js'
import { BrowseSession, SessionEnded } from './session.js'

for (const keywords of ['', 'fitness']) {
  for (const [homeFeed, reels] of [[true, true], [true, false], [false, true], [false, false]]) {
    test(`browsing respects home feed=${homeFeed}, reels=${reels}, keywords=${keywords || 'blank'}`, async () => {
      let now = Date.now()
      const end = now + 600_000, calls: string[] = []
      const budget = new WarmupActivityBudget({ likes: 0, profiles: 3, reels: 20, stories: 2 })
      const state: TopicBrowseState = { feedViewed: false, profilesChecked: true, seenPosts: new Set(), searchTerms: ['strength training'] }
      const config = { browse_home_feed: homeFeed, scroll_reels: reels, warmup_topics: keywords }
      const deps: NonNullable<Parameters<typeof browseTopics>[7]> = {
        now: () => now, random: min => min,
        feed: async (_p, minutes) => {
          assert.ok(homeFeed, 'a disabled home feed must never be a fallback')
          calls.push('feed'); now += minutes * 60_000; return 'finished'
        },
        profiles: async () => { throw new Error('Already checked profiles') },
        topic: async (_p, _topic, _count, _budget, _seen, session) => {
          assert.ok(reels, 'disabled reels must also suppress topic-result viewing')
          calls.push('topic'); now = session.end
        },
        openReels: async () => { assert.ok(reels); calls.push('open-reels'); return true },
        reels: async () => { assert.ok(reels); calls.push('reels'); now += 1000 },
      }
      assert.equal(await browseTopics({} as Page, end, config, budget, state, () => {}, () => false, deps), 'finished')
      assert.equal(calls.includes('feed'), homeFeed)
      if (keywords || !homeFeed) assert.equal(calls.includes('reels'), reels)
      assert.equal(calls.includes('topic'), Boolean(keywords && reels))
    })
  }
}

test('reels-only does not fall back to the home feed after the daily reel cap', async () => {
  const budget = new WarmupActivityBudget({ likes: 0, profiles: 0, reels: 0, stories: 0 })
  const state = { feedViewed: false, profilesChecked: false, seenPosts: new Set<string>(), searchTerms: ['strength training'] }
  const deps = { now: Date.now, random: (min: number) => min,
    feed: async () => { throw new Error('Disabled feed') },
    topic: async () => { throw new Error('Reel quota exhausted') },
    openReels: async () => { throw new Error('Reel quota exhausted') },
  } as unknown as NonNullable<Parameters<typeof browseTopics>[7]>
  assert.equal(await browseTopics({} as Page, Date.now() + 60_000,
    { browse_home_feed: false, warmup_topics: 'fitness' }, budget, state, () => {}, () => false, deps), 'finished')
})

test('topic browsing keeps the feed glance brief and continues into normal reels after a topic deadline', async () => {
  const originalNow = Date.now
  let now = originalNow()
  Date.now = () => now
  try {
    const start = now, end = now + 600_000, calls: string[] = []
    const budget = new WarmupActivityBudget({ likes: 0, profiles: 3, reels: 20, stories: 2 })
    const state: TopicBrowseState = { feedViewed: false, profilesChecked: false, seenPosts: new Set(), searchTerms: ['strength training'] }
    const config = { warmup_topics: 'strength training, gym' }
    const deps: NonNullable<Parameters<typeof browseTopics>[7]> = {
      now: () => now, random: min => min,
      feed: async (_p, minutes, feedConfig) => {
        if (!calls.length) {
          assert.ok(minutes * 60 <= 90)
          assert.equal(feedConfig.profile_visit_chance, 0)
        }
        calls.push('feed')
        now += minutes * 60_000; return 'finished'
      },
      profiles: async (_p, topic, _b, session) => {
        assert.equal(topic, 'strength training'); calls.push('profiles')
        now = session.end; throw new SessionEnded()
      },
      topic: async (_p, topic, _c, _b, seen, session, _log, _maintenance, _matcher, intent) => {
        assert.equal(topic, 'strength training'); assert.equal(seen, state.seenPosts)
        assert.deepEqual(intent, ['strength training, gym'])
        calls.push('topic'); now = session.end; throw new SessionEnded()
      },
      openReels: async () => { calls.push('open-reels'); return true },
      reels: async (_p, _count, passedConfig) => { assert.equal(passedConfig, config); calls.push('reels') },
    }
    assert.equal(await browseTopics({} as Page, end, config, budget, state, () => {}, () => false, deps), 'finished')
    assert.deepEqual(calls, ['feed', 'profiles', 'topic', 'open-reels', 'reels', 'feed'])
    assert.ok(now > start)
    assert.equal(now, end)
    assert.equal(state.feedViewed, true)
    assert.equal(state.profilesChecked, true)
    assert.equal(topicGridUrl('strength training'), 'https://www.instagram.com/explore/search/keyword/?q=strength%20training')
  } finally { Date.now = originalNow }
})

test('unavailable generated searches continue enabled browsing without searching the raw description', async () => {
  const calls: string[] = []
  const deps = { now: Date.now, random: (min: number) => min,
    profiles: async () => { throw new Error('Must not search without generated phrases') },
    topic: async () => { throw new Error('Must not search without generated phrases') },
    openReels: async () => { calls.push('open-reels'); return true },
    reels: async (_p: Page, _count: number, config: Record<string, unknown>) => {
      assert.equal(config.warmup_topics, 'Fitness, excluding competitions'); calls.push('reels')
    },
    feed: async () => { calls.push('feed'); return 'finished' },
  } as unknown as NonNullable<Parameters<typeof browseTopics>[7]>
  assert.equal(await browseTopics({} as Page, Date.now() + 120_000,
    { warmup_topics: 'Fitness, excluding competitions' },
    new WarmupActivityBudget({ likes: 0, profiles: 2, reels: 20, stories: 0 }),
    { feedViewed: true, profilesChecked: false, seenPosts: new Set(), searchTerms: [] },
    () => {}, () => false, deps), 'finished')
  assert.deepEqual(calls, ['open-reels', 'reels', 'feed'])
})

test('Instagram warnings are propagated instead of treated as the end of a topic phase', async () => {
  const budget = new WarmupActivityBudget({ likes: 0, profiles: 3, reels: 20, stories: 2 })
  const state = { feedViewed: true, profilesChecked: true, seenPosts: new Set<string>(), searchTerms: ['strength training'] }
  const deps = { now: Date.now, random: (min: number) => min,
    topic: async () => { throw new Error('Instagram limit needs attention') } } as unknown as NonNullable<Parameters<typeof browseTopics>[7]>
  await assert.rejects(browseTopics({} as Page, Date.now() + 60_000, { warmup_topics: 'fitness' },
    budget, state, () => {}, () => false, deps), /Instagram limit needs attention/)
})

for (const failure of [new errors.TimeoutError('Click timed out while moving to its target'), new ElementNotVisibleError('<ElementHandle>')])
  test(`temporary Explore failure continues into normal reels: ${failure.name}`, async () => {
    const calls: string[] = []
    const page = { url: () => 'https://www.instagram.com/explore/',
      locator: () => ({ filter: () => ({ evaluateAll: async () => null }) }) } as unknown as Page
    const deps = { now: Date.now, random: (min: number) => min,
      topic: async () => { throw failure },
      openReels: async () => { calls.push('open-reels'); return true },
      reels: async () => { calls.push('reels') },
      feed: async () => { calls.push('feed'); return 'finished' },
    } as unknown as NonNullable<Parameters<typeof browseTopics>[7]>
    const result = await browseTopics(page, Date.now() + 60_000, { warmup_topics: 'fitness' },
      new WarmupActivityBudget({ likes: 0, profiles: 0, reels: 20, stories: 0 }),
      { feedViewed: true, profilesChecked: true, seenPosts: new Set(), searchTerms: ['strength training'] },
      event => { assert.equal(event.outcome, 'skipped'); calls.push('skipped') }, () => false, deps)
    assert.equal(result, 'finished')
    assert.deepEqual(calls, ['skipped', 'open-reels', 'reels', 'feed'])
  })

test('Explore timeout recovery still stops on an Instagram checkpoint', async () => {
  const page = { url: () => 'https://www.instagram.com/challenge/123/' } as Page
  const deps = { now: Date.now, random: (min: number) => min,
    topic: async () => { throw new errors.TimeoutError('Click timed out') },
    openReels: async () => { throw new Error('Must stop before opening reels') },
  } as unknown as NonNullable<Parameters<typeof browseTopics>[7]>
  await assert.rejects(browseTopics(page, Date.now() + 60_000, { warmup_topics: 'fitness' },
    new WarmupActivityBudget({ likes: 0, profiles: 0, reels: 20, stories: 0 }),
    { feedViewed: true, profilesChecked: true, seenPosts: new Set(), searchTerms: ['strength training'] }, () => {}, () => false, deps), /checkpoint needs attention/)
})

test('a stop during an Explore failure prevents fallback browsing', async () => {
  let stopped = false
  const deps = { now: Date.now, random: (min: number) => min,
    topic: async () => { stopped = true; throw new errors.TimeoutError('Click timed out') },
    openReels: async () => { throw new Error('Must not browse after stopping') },
  } as unknown as NonNullable<Parameters<typeof browseTopics>[7]>
  assert.equal(await browseTopics({} as Page, Date.now() + 60_000, { warmup_topics: 'fitness' },
    new WarmupActivityBudget({ likes: 0, profiles: 0, reels: 20, stories: 0 }),
    { feedViewed: true, profilesChecked: true, seenPosts: new Set(), searchTerms: ['strength training'] }, () => {}, () => stopped, deps), 'stopped')
})

test('topic results use the outer Next control and never carousel or engagement buttons', async () => {
  const originalNow = Date.now
  let now = originalNow()
  let url = '', nextClicks = 0, closed = false
  const next = { isVisible: async () => true, elementHandle: async () => ({
    ...visibleActionGeometry, hover: async () => {},
    click: async () => { url = 'https://www.instagram.com/p/two/'; nextClicks++ }, dispose: async () => {} }),
  }
  const article = { evaluate: async () => ({ text: 'Strength exercises', relationship: 'not-followed' as const }), waitFor: async () => {}, getByText: () => ({ count: async () => 0 }),
    locator: (selector: string) => {
      assert.equal(selector, 'video')
      const video = { count: async () => 0, first: () => video }
      return video
    },
  }
  const dialog = { filter() { return this }, first() { return this }, getByRole: (role: string) => {
    assert.equal(role, 'article'); return article
  }, locator: (selector: string) => { assert.equal(selector, TOPIC_NEXT_RESULT); return next } }
  const tile = { ...visibleActionGeometry, getAttribute: async () => '/p/one/', isVisible: async () => true,
    elementHandle: async () => ({ ...visibleActionGeometry, hover: async () => { now += 6000 }, click: async () => { url = 'https://www.instagram.com/p/one/' }, dispose: async () => {} }) }
  const tiles = { first: () => ({ waitFor: async () => {} }), count: async () => 1, nth: () => tile }
  const page = {
    viewportSize: () => ({ width: 1280, height: 800 }),
    url: () => url, goto: async (value: string) => { url = value },
    waitForURL: async (matches: (value: URL) => boolean) => { assert.ok(matches(new URL(url))) },
    getByRole: (role: string) => { assert.equal(role, 'dialog'); return dialog },
    locator: (selector: string) => {
      if (selector.startsWith('main a')) return tiles
      if (selector === 'div[role="dialog"]') return { first: () => ({ isVisible: async () => false }) }
      assert.equal(selector, '[role="dialog"], [role="alertdialog"], [role="alert"]')
      return { filter: () => ({ evaluateAll: async () => null }) }
    },
    keyboard: { press: async (key: string) => { assert.equal(key, 'Escape'); closed = true } },
  } as unknown as Page
  const session = new BrowseSession(Date.now() + 60_000)
  session.wait = async () => {}
  const seen = new Set<string>()
  Date.now = () => now
  try {
    await watchTopicPosts(page, 'fitness', 2, new WarmupActivityBudget({ likes: 0, profiles: 2, reels: 20, stories: 2 }),
      seen, session, () => {}, false, async (_context, topics) => {
        assert.deepEqual(topics, ['Fitness training, excluding competitions'])
        return true
      }, ['Fitness training, excluding competitions'])
  } finally { Date.now = originalNow }
  assert.equal(nextClicks, 1)
  assert.deepEqual([...seen], ['/p/one/', '/p/two/'])
  assert.equal(closed, true)
})

test('completed playback is recorded before optional comment reading expires', async () => {
  const originalNow = Date.now, originalRandom = Math.random
  let now = originalNow(), url = '', closed = false
  const started = now
  Date.now = () => now
  Math.random = () => 0
  const video = { first() { return this }, count: async () => 1,
    evaluate: async (read: (media: { currentTime: number; paused: boolean; ended: boolean }) => unknown) =>
      read({ currentTime: (now - started) / 1000, paused: false, ended: false }),
  }
  const thread = { first() { return this }, isVisible: async () => true }
  const article = { waitFor: async () => {}, getByText: () => ({ count: async () => 0 }),
    evaluate: async () => ({ text: 'Strength exercises', relationship: 'followed' }),
    locator: (selector: string) => {
      if (selector === 'video') return video
      assert.equal(selector, 'ul'); return thread
    },
  }
  const dialog = { filter() { return this }, first() { return this }, count: async () => 1,
    getByRole: () => article,
  }
  const tile = { ...visibleActionGeometry, getAttribute: async () => '/p/one/', isVisible: async () => true,
    elementHandle: async () => ({ ...visibleActionGeometry, hover: async () => {},
      click: async () => { url = 'https://www.instagram.com/p/one/' }, dispose: async () => {},
    }),
  }
  const tiles = { first: () => ({ waitFor: async () => {} }), count: async () => 1, nth: () => tile }
  const page = { viewportSize: () => ({ width: 1280, height: 800 }), url: () => url,
    goto: async (value: string) => { url = value }, getByRole: () => dialog,
    locator: (selector: string) => selector.startsWith('main a') ? tiles
      : { filter: () => ({ evaluateAll: async () => null }) },
    keyboard: { press: async () => { closed = true } },
  } as unknown as Page
  const session = new BrowseSession(now + 10_000)
  session.wait = async ms => { now = Math.min(session.end, now + ms); session.check() }
  const budget = new WarmupActivityBudget({ likes: 0, profiles: 0, reels: 1, stories: 0, comments: 1 })
  try {
    await assert.rejects(watchTopicPosts(page, 'fitness', 1, budget, new Set(), session, () => {}, true, async () => true, ['fitness']), SessionEnded)
    assert.equal(budget.browsed, 1)
    assert.equal(budget.used.reels, 1)
    assert.equal(budget.used.comments, 1)
    assert.equal(closed, true)
  } finally { Date.now = originalNow; Math.random = originalRandom }
})
