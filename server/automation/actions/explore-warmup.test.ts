import { visibleActionGeometry } from './action-locator.test-support.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { runExploreWarmup, watchTopicPosts } from './explore-warmup.js'
import { BrowseSession, SessionEnded } from './session.js'

for (const [day, interests, home, reels, expected] of [
  [1, ['Fishing'], true, true, true], [4, ['Fishing'], false, true, true],
  [4, ['Fishing'], true, false, true], [5, ['Fishing'], true, true, false],
  [1, [], true, true, false], [1, ['Fishing'], false, false, false],
] as const) test(`Explore warm-up routing: day=${day}, Home=${home}, Reels=${reels}`, async () => {
  let calls = 0
  const end = Date.now() + 60_000
  const deps: NonNullable<Parameters<typeof runExploreWarmup>[6]> = {
    now: Date.now, random: min => min,
    terms: async topics => { assert.deepEqual(topics, ['Fishing']); return ['fishing'] },
    posts: async (_page, query, count, _budget, _seen, session, _log, engage, _matcher, topics) => {
      assert.equal(query, 'fishing'); assert.equal(count, Infinity); assert.equal(session.end, end)
      assert.equal(engage, day >= 2); assert.deepEqual(topics, ['Fishing']); calls++
    },
  }
  await runExploreWarmup({} as Page, end, { warmup_day: day, warmup_topics: interests,
    browse_home_feed: home, scroll_reels: reels },
    new WarmupActivityBudget({ likes: 2, profiles: 2, reels: 0, stories: 0 }), () => {}, () => false, deps)
  assert.equal(calls, expected ? 1 : 0)
})

test('unavailable Explore search and its local deadline return to the session flow', async () => {
  const page = { url: () => 'https://www.instagram.com/explore/',
    locator: () => ({ filter: () => ({ evaluateAll: async () => null }) }) } as unknown as Page
  for (const failure of [new errors.TimeoutError('Search loading timed out'), new SessionEnded()]) {
    const deps = { now: Date.now, random: (min: number) => min, terms: async () => ['fishing'],
      posts: async () => { throw failure },
    }
    await runExploreWarmup(page, Date.now() + 60_000, { warmup_topics: ['Fishing'] },
      new WarmupActivityBudget({ likes: 2, profiles: 2, reels: 0, stories: 0 }), () => {}, () => false, deps)
  }
})

test('Explore still propagates checkpoints and lost browser connections', async () => {
  for (const error of [new Error('Instagram checkpoint needs attention'), new Error('Browser disconnected')])
    await assert.rejects(runExploreWarmup({} as Page, Date.now() + 60_000, { warmup_topics: ['Fishing'] },
      new WarmupActivityBudget({ likes: 2, profiles: 2, reels: 0, stories: 0 }), () => {}, () => false,
      { now: Date.now, random: min => min, terms: async () => ['fishing'], posts: async () => { throw error } }), error)
})

test('topic results scroll the grid between opened posts without direct URL navigation', async () => {
  const originalNow = Date.now
  let now = originalNow()
  let url = 'https://www.instagram.com/explore/', scrolls = 0, closed = 0
  const article = { evaluate: async () => ({ text: 'Strength exercises', relationship: 'not-followed' as const }), waitFor: async () => {}, getByText: () => ({ count: async () => 0 }),
    locator: (selector: string) => {
      assert.equal(selector, 'video')
      const video = { count: async () => 0, first: () => video }
      return video
    },
  }
  const dialog = { filter() { return this }, first() { return this }, getByRole: (role: string) => {
    assert.equal(role, 'article'); return article
  } }
  const tile = { ...visibleActionGeometry, getAttribute: async () => scrolls ? '/p/two/' : '/p/one/', isVisible: async () => true,
    elementHandle: async () => ({ ...visibleActionGeometry, hover: async () => { now += 6000 },
      click: async () => { url = `https://www.instagram.com/p/${scrolls ? 'two' : 'one'}/` }, dispose: async () => {} }) }
  const tiles = { first: () => ({ waitFor: async () => {} }), count: async () => 1, nth: () => tile,
    evaluateAll: async () => [{ href: await tile.getAttribute(), box: await tile.boundingBox() }],
  }
  const page = {
    viewportSize: () => ({ width: 1280, height: 800 }),
    url: () => url, goto: async () => { throw new Error('Must use UI search') },
    mouse: { move: async () => {} },
    waitForURL: async (matches: (value: URL) => boolean) => { assert.ok(matches(new URL(url))) },
    getByRole: (role: string) => { assert.equal(role, 'dialog'); return dialog },
    locator: (selector: string) => {
      if (selector.startsWith('main a[href=')) return { ...tile, first() { return this } }
      if (selector.startsWith('main a')) return tiles
      if (selector === 'div[role="dialog"]') return { first: () => ({ isVisible: async () => false }) }
      assert.equal(selector, '[role="dialog"], [role="alertdialog"], [role="alert"]')
      return { filter: () => ({ evaluateAll: async () => null }) }
    },
    keyboard: { press: async (key: string) => { assert.equal(key, 'Escape'); closed++; url = 'https://www.instagram.com/explore/' } },
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
      }, ['Fitness training, excluding competitions'], {
        search: async (_page, topic) => { assert.equal(topic, 'fitness'); return true },
        scroll: async () => { scrolls++ },
        grid: async (_page, tiles) => tiles.map(tile => tile.href),
      })
  } finally { Date.now = originalNow }
  assert.equal(scrolls, 1)
  assert.deepEqual([...seen], ['/p/one/', '/p/two/'])
  assert.equal(closed, 2)
})

test('completed playback is recorded before optional comment reading expires', async () => {
  const originalNow = Date.now, originalRandom = Math.random
  let now = originalNow(), url = 'https://www.instagram.com/explore/', closed = false
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
  const tiles = { first: () => ({ waitFor: async () => {} }), count: async () => 1, nth: () => tile,
    evaluateAll: async () => [{ href: await tile.getAttribute(), box: await tile.boundingBox() }],
  }
  const page = { viewportSize: () => ({ width: 1280, height: 800 }), url: () => url,
    goto: async (value: string) => { url = value }, getByRole: () => dialog,
    locator: (selector: string) => selector.startsWith('main a[href=') ? { ...tile, first() { return this } }
      : selector.startsWith('main a') ? tiles
      : { filter: () => ({ evaluateAll: async () => null }) },
    keyboard: { press: async () => { closed = true } },
  } as unknown as Page
  const session = new BrowseSession(now + 10_000)
  session.wait = async ms => { now = Math.min(session.end, now + ms); session.check() }
  const budget = new WarmupActivityBudget({ likes: 0, profiles: 0, reels: 1, stories: 0, comments: 1 })
  try {
    await assert.rejects(watchTopicPosts(page, 'fitness', 1, budget, new Set(), session, () => {}, true, async () => true, ['fitness'], {
      search: async () => true, scroll: async () => { throw new Error('No scrolling after final view') },
      grid: async (_page, tiles) => tiles.map(tile => tile.href),
    }), SessionEnded)
    assert.equal(budget.browsed, 1)
    assert.equal(budget.used.reels, 1)
    assert.equal(budget.used.comments, 1)
    assert.equal(closed, true)
  } finally { Date.now = originalNow; Math.random = originalRandom }
})

for (const gridMatch of [false, true]) test(`Explore requires both grid and opened-post evidence before engagement (grid match=${gridMatch})`, async () => {
  const originalNow = Date.now
  let now = originalNow(), clicks = 0, decisions = 0, url = 'https://www.instagram.com/explore/'
  Date.now = () => now
  const article = { waitFor: async () => {}, getByText: () => ({ count: async () => 0 }),
    evaluate: async () => ({ text: 'fishing', relationship: 'not-followed' }),
    locator: () => { throw new Error('An off-topic post must not be viewed or engaged') },
  }
  const dialog = { filter() { return this }, first() { return this }, getByRole: () => article }
  const item = { ...visibleActionGeometry, first() { return this }, isVisible: async () => true,
    elementHandle: async () => ({ ...visibleActionGeometry, hover: async () => {}, click: async () => {
      clicks++; url = 'https://www.instagram.com/p/one/'
    }, dispose: async () => {} }),
  }
  const tiles = { first: () => ({ waitFor: async () => {} }), evaluateAll: async () => [
    { href: '/p/one/', box: await item.boundingBox() },
  ] }
  const page = { viewportSize: () => ({ width: 1280, height: 800 }), url: () => url,
    mouse: { move: async () => {} }, getByRole: () => dialog,
    locator: (selector: string) => selector.startsWith('main a[href=') ? item
      : selector.startsWith('main a') ? tiles
      : selector === 'div[role="dialog"]' ? { first: () => ({ isVisible: async () => false }) }
      : { filter: () => ({ evaluateAll: async () => null }) },
    keyboard: { press: async () => { url = 'https://www.instagram.com/explore/' } },
  } as unknown as Page
  const session = new BrowseSession(now + 60_000)
  session.wait = async () => session.check()
  const budget = new WarmupActivityBudget({ likes: 2, profiles: 2, reels: 20, stories: 0 })
  try {
    await assert.rejects(watchTopicPosts(page, 'fishing', 1, budget, new Set(), session, () => {}, true,
      async () => { decisions++; return false }, ['Fishing'], {
        search: async () => true, grid: async () => gridMatch ? ['/p/one/'] : [],
        scroll: async () => { now = session.end; session.check() },
      }), SessionEnded)
    assert.equal(clicks, gridMatch ? 1 : 0)
    assert.equal(decisions, gridMatch ? 1 : 0)
    assert.equal(budget.browsed, 0)
    assert.equal(budget.used.likes, 0)
  } finally { Date.now = originalNow }
})
