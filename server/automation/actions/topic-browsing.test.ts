import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { browseTopics, watchTopicPosts, topicGridUrl, TOPIC_NEXT_RESULT, type TopicBrowseState } from './topic-browsing.js'
import { BrowseSession, SessionEnded } from './session.js'

for (const keywords of ['', 'fitness']) {
  for (const [homeFeed, reels] of [[true, true], [true, false], [false, true], [false, false]]) {
    test(`browsing respects home feed=${homeFeed}, reels=${reels}, keywords=${keywords || 'blank'}`, async () => {
      let now = Date.now()
      const end = now + 600_000, calls: string[] = []
      const budget = new WarmupActivityBudget({ likes: 0, profiles: 3, reels: 20, stories: 2 })
      const state: TopicBrowseState = { feedViewed: false, profilesChecked: true, seenPosts: new Set() }
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
  const state = { feedViewed: false, profilesChecked: false, seenPosts: new Set<string>() }
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
    const state: TopicBrowseState = { feedViewed: false, profilesChecked: false, seenPosts: new Set() }
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
      topic: async (_p, topic, _c, _b, seen, session) => {
        assert.equal(topic, 'strength training'); assert.equal(seen, state.seenPosts)
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

test('Instagram warnings are propagated instead of treated as the end of a topic phase', async () => {
  const budget = new WarmupActivityBudget({ likes: 0, profiles: 3, reels: 20, stories: 2 })
  const state = { feedViewed: true, profilesChecked: true, seenPosts: new Set<string>() }
  const deps = { now: Date.now, random: (min: number) => min,
    topic: async () => { throw new Error('Instagram limit needs attention') } } as unknown as NonNullable<Parameters<typeof browseTopics>[7]>
  await assert.rejects(browseTopics({} as Page, Date.now() + 60_000, { warmup_topics: 'fitness' },
    budget, state, () => {}, () => false, deps), /Instagram limit needs attention/)
})

test('topic results use the outer Next control and never carousel or engagement buttons', async () => {
  let url = '', nextClicks = 0, closed = false
  const next = { isVisible: async () => true, elementHandle: async () => ({
    click: async () => { url = 'https://www.instagram.com/p/two/'; nextClicks++ }, dispose: async () => {} }),
  }
  const article = { waitFor: async () => {}, getByText: () => ({ count: async () => 0 }),
    locator: (selector: string) => {
      assert.equal(selector, 'video')
      const video = { count: async () => 0, first: () => video }
      return video
    },
  }
  const dialog = { filter() { return this }, first() { return this }, getByRole: (role: string) => {
    assert.equal(role, 'article'); return article
  }, locator: (selector: string) => { assert.equal(selector, TOPIC_NEXT_RESULT); return next } }
  const tile = { getAttribute: async () => '/p/one/', isVisible: async () => true,
    elementHandle: async () => ({ click: async () => { url = 'https://www.instagram.com/p/one/' }, dispose: async () => {} }) }
  const tiles = { first: () => ({ waitFor: async () => {} }), count: async () => 1, nth: () => tile }
  const page = {
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
  await watchTopicPosts(page, 'fitness', 2, new WarmupActivityBudget({ likes: 0, profiles: 2, reels: 20, stories: 2 }),
    seen, session, () => {})
  assert.equal(nextClicks, 1)
  assert.deepEqual([...seen], ['/p/one/', '/p/two/'])
  assert.equal(closed, true)
})
