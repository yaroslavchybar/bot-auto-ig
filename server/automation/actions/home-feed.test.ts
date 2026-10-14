import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import type { Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { browseHomeFeed, visibleFeedPost } from './home-feed.js'

function pageWithPosts(tops: number[]) {
  const posts = tops.map((y, index) => ({
    boundingBox: async () => ({ x: 0, y, width: 500, height: 250 }),
    locator: () => ({ first: () => ({ getAttribute: async () => `/p/post${index}/` }) }),
  }))
  return {
    viewportSize: () => ({ width: 1280, height: 800 }),
    locator: () => ({ count: async () => posts.length, nth: (i: number) => posts[i] }),
  } as unknown as Page
}

test('finds visible posts beyond the first six articles', async () => {
  const result = await visibleFeedPost(pageWithPosts([-3000, -2500, -2000, -1500, -1000, -500, 100]), new Set())
  assert.equal(result?.id, 'post6')
})

test('prefers unread visible posts and never falls back to an offscreen article', async () => {
  const page = pageWithPosts([-500, 100, 400])
  assert.equal((await visibleFeedPost(page, new Set(['post1'])))?.id, 'post2')
  assert.equal((await visibleFeedPost(page, new Set(['post1', 'post2'])))?.id, 'post2')
  assert.equal(await visibleFeedPost(pageWithPosts([-500, 900]), new Set()), null)
})

test('zero budget never navigates the browser', async () => {
  const page = { mouse: { move: async () => {} }, goto: async () => { throw new Error('Must not navigate') } } as unknown as Page
  assert.equal(await browseHomeFeed(page, 0, {}, () => {}, () => false), 'stopped')
})

test('disabled home feed never navigates even with reels detours configured', async () => {
  const page = { goto: async () => { throw new Error('Must not navigate') } } as unknown as Page
  assert.equal(await browseHomeFeed(page, 10, { browse_home_feed: false, reels_chance: 100 }, () => {}, () => false), 'finished')
})

test('temporary Home navigation failure stalls browsing without ending the reservation', async () => {
  const notes: Record<string, unknown>[] = []
  const page = { url: () => 'https://www.instagram.com/reels/current/',
    goto: async () => { throw new errors.TimeoutError('Home navigation timed out') },
    locator: () => ({ filter: () => ({ evaluateAll: async () => null }) }),
  } as unknown as Page
  assert.equal(await browseHomeFeed(page, 1, {}, note => notes.push(note), () => false), 'stalled')
  assert.equal(notes[0]?.event, 'automation.actions.feed.browsing_unavailable')
})

test('Home navigation recovery still propagates checkpoints and lost browser connections', async () => {
  for (const checkpoint of [false, true]) {
    let navigated = false
    const page = { url: () => navigated && checkpoint ? 'https://www.instagram.com/challenge/' : 'https://www.instagram.com/reels/current/',
      goto: async () => { navigated = true; throw checkpoint ? new errors.TimeoutError('Navigation timed out') : new Error('Browser disconnected') },
    } as unknown as Page
    await assert.rejects(browseHomeFeed(page, 1, {}, () => {}, () => false), checkpoint ? /checkpoint needs attention/ : /Browser disconnected/)
  }
})

test('Home feed always classifies content and never navigates to Reels', () => {
  // Isolate module mocks so the other browser-action tests keep their real dependencies.
  execFileSync('bun', ['--eval', `
    import assert from 'node:assert/strict'
    import { mock } from 'bun:test'
    let now = 0, stopped, mode, decisions, reads, reels, config, skips, aligns
    Date.now = () => now
    Math.random = () => 0.5
    const session = await import('./server/automation/actions/session.ts')
    mock.module('./server/automation/actions/session.ts', () => ({ ...session,
      BrowseSession: class {
        constructor(end, stop) { this.end = end; this.stop = stop }
        stopped() { return this.stop() || now >= this.end }
        check() { if (this.stopped()) throw new session.SessionEnded() }
        timeout(max) { this.check(); return Math.min(max, this.end - now) }
        wait = async ms => { now += ms; this.check() }
      }
    }))
    const replace = async (path, overrides) => mock.module(path, () => ({ ...modules[path], ...overrides }))
    const modules = {}
    for (const name of ['scroll', 'mouse', 'navigation', 'instagram-state', 'viewing', 'reels']) {
      const path = './server/automation/actions/' + name + '.ts'
      modules[path] = await import(path)
    }
    await replace('./server/automation/actions/scroll.ts', {
      alignPostOnScreen: async () => { aligns++ },
      quickScroll: async () => { skips++; now += 50; stopped = true },
      smoothScroll: async () => {
        now += 1000
        if (mode === 'off-topic') stopped = true
      }
    })
    await replace('./server/automation/actions/mouse.ts', { driftMouse: async () => {} })
    await replace('./server/automation/actions/navigation.ts', { dismissPopups: async () => false })
    await replace('./server/automation/actions/instagram-state.ts', { assertInstagramReady: async () => {} })
    await replace('./server/automation/actions/viewing.ts', {
      viewContent: async () => { now += 31_000; return true },
    })
    const matcher = async (_context, _topics, _session, _log, target) => {
      assert.equal(target, post, 'topic screenshot must use the current feed article')
      decisions++; if (mode === 'match') stopped = true; return mode !== 'off-topic'
    }
    await replace('./server/automation/actions/reels.ts', {
      openReels: async () => true,
      watchReels: async (...args) => { assert.equal(args[8], matcher); assert.equal(args[1], Infinity); assert.equal(args[5], 120_000); reels++; stopped = true }
    })
    const empty = { count: async () => 0, first() { return this }, filter() { return this },
      waitFor: async () => {}, getAttribute: async () => '/p/post' + reads + '/' }
    const post = { boundingBox: async () => ({ x: 100, y: 100, width: 500, height: 400 }),
      locator: () => empty,
      evaluate: async () => { reads++; return { text: 'Barbell squats', relationship: 'not-followed', sponsored: mode === 'ad' } }
    }
    const page = { mouse: { move: async () => {} },
      goto: async () => { throw new Error('The open Home feed must not be refreshed') }, url: () => 'https://www.instagram.com/',
      viewportSize: () => ({ width: 1280, height: 800 }),
      evaluate: async () => String(now),
      getByText: () => ({ first() { return this }, boundingBox: async () => mode === 'feed-end'
        ? { y: 100, height: 50 } : null }),
      locator: selector => selector === 'article'
        ? { first: () => empty, count: async () => 1, nth: () => post } : empty
    }
    const { browseHomeFeed } = await import('./server/automation/actions/home-feed.ts')
    for (mode of ['off-topic', 'ad', 'match', 'feed-end']) {
      now = 0; stopped = false; decisions = 0; reads = 0; reels = 0; skips = 0; aligns = 0
      config = { warmup_topics: 'fitness', skip_post_chance: 100,
        skip_post_max: 2, own_profile_chance: 0, dm_chance: 0, reels_chance: 100 }
      assert.equal(await browseHomeFeed(page, 2, config, () => {}, () => stopped, undefined, matcher), mode === 'feed-end' ? 'finished' : 'stopped')
      if (mode === 'off-topic' || mode === 'ad') {
        assert.equal(decisions, mode === 'ad' ? 0 : 1, mode)
        assert.equal(aligns, mode === 'ad' ? 0 : 1, mode)
        assert.equal(skips, 1, mode)
        assert.equal(reads, 1, mode)
      } else if (mode === 'match') assert.equal(decisions, 1)
      else assert.equal(reels, 0, mode)
    }
  `], { cwd: process.cwd(), stdio: 'pipe', timeout: 10_000 })
})
