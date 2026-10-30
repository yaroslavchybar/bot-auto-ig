import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errors, type Page } from 'playwright-core'
import { browseContent, runBrowseFeedSession, type FeedSessionContext, type FeedState } from './browse-feed.js'
import { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { SessionEnded } from './session.js'
import { currentUiDiagnosticContext } from './ui-diagnostics.js'

function setup(day = 8) {
  let now = Date.now()
  const start = now, calls: string[] = []
  const budget = new WarmupActivityBudget({ likes: 4, profiles: 3, follows: 2, reels: 0, stories: 0 })
  const context: FeedSessionContext = { day, deadline: start + 600_000, remainingMinutes: 20, unseenStories: true,
    config: { watch_stories: true }, budget, request: { profileId: 'profile', runId: 'run', date: '2026-10-14' } }
  const deps: NonNullable<Parameters<typeof runBrowseFeedSession>[6]> = {
    now: () => now, random: min => min, sleep: async ms => { now += ms },
    waitForOutreach: async (_page, until) => { now = until; return true },
    visitDuringPause: async () => { calls.push('pause-visit') },
    check: async () => { calls.push('check') }, notifications: async () => { calls.push('notifications'); return true },
    unreadNotifications: async () => true,
    inbox: async () => { calls.push('inbox'); return true }, home: async () => { calls.push('home') },
    openReels: async () => { calls.push('open-reels'); return true },
    stories: async (_page, session, _log, timing) => {
      calls.push('stories')
      assert.equal(timing.budget, budget); assert.equal(session.end, context.deadline)
      assert.equal(timing.watchUntil - now, 60_000); now += 60_000; return 12
    },
    content: async (_page, end, _config, shared) => { calls.push('content'); assert.equal(shared, budget); now = end; budget.browsed++; return 'finished' },
    terms: async () => ['fishing'], follow: async () => { calls.push('follow') },
  }
  const run = async (activity?: Parameters<typeof runBrowseFeedSession>[4], notifications?: Parameters<typeof runBrowseFeedSession>[5], stop = () => false) => {
    const originalNow = Date.now
    Date.now = () => now
    try { return await runBrowseFeedSession({} as Page, context, () => {}, stop, activity, notifications, deps) }
    finally { Date.now = originalNow }
  }
  return { context, deps, calls, run, advance: (ms: number) => { now += ms }, now: () => now }
}

test('notifications, inbox and unseen Stories run once before the common browsing loop', async () => {
  const s = setup()
  assert.equal(await s.run(), 'finished')
  assert.deepEqual(s.calls, ['check', 'notifications', 'inbox', 'home', 'stories', 'check', 'content'])
  assert.equal(s.context.budget.used.stories, 12)
  assert.equal(s.now(), s.context.deadline)
})

test('pause visits share the browsing session deadline and selected destination', async () => {
  const s = setup()
  const until = s.now() + 90_000
  s.deps.visitDuringPause = async (_page, destination, end, parent) => {
    assert.equal(destination, 'dms'); assert.equal(end, until); assert.equal(parent.end, s.context.deadline)
    s.calls.push('pause-visit')
  }
  await s.run(async session => { await session.visitDuringPause!('dms', until); return 'finished' })
  assert.equal(s.calls.filter(call => call === 'pause-visit').length, 1)
})

test('due follow-back scanning replaces the single startup notification visit', async () => {
  const s = setup()
  s.deps.notifications = async () => { throw new Error('Duplicate notification visit') }
  await s.run(undefined, async (session, day) => {
    assert.equal(session.end, s.context.deadline); assert.equal(day, 8); s.calls.push('follow-back')
  })
  assert.deepEqual(s.calls.filter(call => call !== 'check'), ['follow-back', 'inbox', 'home', 'stories', 'content'])
})

test('daily follow-back tracking runs without an unread badge while brief notification visits stay skipped', async () => {
  for (const followBack of [false, true]) {
    const s = setup()
    s.deps.unreadNotifications = async () => false
    s.deps.notifications = async () => { throw new Error('No unread notifications') }
    await s.run(undefined, followBack ? async (_session, _day, unread) => {
      assert.equal(unread, false); s.calls.push('follow-back')
    } : undefined)
    assert.deepEqual(s.calls, ['check', ...(followBack ? ['follow-back'] : []), 'inbox', 'home', 'stories', 'check', 'content'])
  }
})

test('temporary unread detection errors recover through one brief notification check', async () => {
  const s = setup()
  s.deps.unreadNotifications = async () => { throw new Error('locator.evaluateAll: Execution context was destroyed, most likely because of a navigation') }
  assert.equal(await s.run(), 'finished')
  assert.deepEqual(s.calls, ['check', 'notifications', 'inbox', 'home', 'stories', 'check', 'content'])
})

test('badge detection failures use one full tracking scan instead of reading notifications twice', async () => {
  const s = setup()
  s.deps.unreadNotifications = async () => { throw new errors.TimeoutError('Navigation still settling') }
  await s.run(undefined, async (_session, _day, unread) => {
    assert.equal(unread, true); s.calls.push('follow-back')
  })
  assert.equal(s.calls.filter(call => call === 'follow-back').length, 1)
  assert.ok(!s.calls.includes('notifications'))
})

test('an unavailable notification panel after detection recovery still allows browsing', async () => {
  const s = setup()
  s.deps.unreadNotifications = async () => { throw new errors.TimeoutError('Navigation still settling') }
  s.deps.notifications = async () => { s.calls.push('notifications'); return false }
  assert.equal(await s.run(), 'finished')
  assert.equal(s.calls.filter(call => call === 'notifications').length, 1)
  assert.ok(s.calls.includes('inbox') && s.calls.includes('content'))
})

test('non-temporary unread detection errors propagate without attempting notification recovery', async () => {
  const s = setup(), error = new Error('Browser disconnected')
  s.deps.unreadNotifications = async () => { throw error }
  await assert.rejects(s.run(), error)
  assert.deepEqual(s.calls, ['check'])
})

test('cancellation during unread detection prevents notification recovery and further startup work', async () => {
  const s = setup()
  let stopped = false
  s.deps.unreadNotifications = async () => { stopped = true; throw new errors.TimeoutError('Interrupted navigation') }
  await assert.rejects(s.run(undefined, undefined, () => stopped), SessionEnded)
  assert.deepEqual(s.calls, ['check'])
})

test('non-temporary failures from notification recovery continue to propagate', async () => {
  const s = setup(), error = new Error('Instagram checkpoint needs attention')
  s.deps.unreadNotifications = async () => { throw new errors.TimeoutError('Navigation still settling') }
  s.deps.notifications = async () => { throw error }
  await assert.rejects(s.run(), error)
  assert.deepEqual(s.calls, ['check'])
})

test('Reels-only startup goes from notifications and inbox straight to Reels without Home or Stories', async () => {
  const s = setup()
  s.context.config = { browse_home_feed: false, scroll_reels: true, watch_stories: true }
  s.context.unseenStories = false
  assert.equal(await s.run(), 'finished')
  assert.deepEqual(s.calls, ['check', 'notifications', 'inbox', 'open-reels', 'content'])
  assert.equal(s.context.budget.used.stories, 0)
})

test('Reels-only startup returns Home for initially unseen Stories before opening Reels', async () => {
  const s = setup()
  s.context.config = { browse_home_feed: false, scroll_reels: true, watch_stories: true }
  assert.equal(await s.run(), 'finished')
  assert.deepEqual(s.calls, ['check', 'notifications', 'inbox', 'home', 'stories', 'check', 'open-reels', 'content'])
  assert.equal(s.context.budget.used.stories, 12)
})

test('disabled Stories do not cause a Home detour even with an initial unseen marker', async () => {
  const s = setup()
  s.context.config = { browse_home_feed: false, scroll_reels: true, watch_stories: false }
  await s.run()
  assert.deepEqual(s.calls, ['check', 'notifications', 'inbox', 'open-reels', 'content'])
})

test('disabled browsing surfaces do not force a Home or Reels visit at startup', async () => {
  const s = setup()
  s.context.config = { browse_home_feed: false, scroll_reels: false }
  s.context.unseenStories = false
  await s.run()
  assert.ok(!s.calls.some(call => ['home', 'open-reels', 'stories'].includes(call)))
})

test('startup stop prevents inbox, Stories and browsing', async () => {
  const s = setup()
  let stopped = false
  assert.equal(await s.run(undefined, async () => { stopped = true }, () => stopped), 'stopped')
  assert.deepEqual(s.calls, ['check'])
})

test('missing Stories end immediately and optional local expiry leaves browsing time', async () => {
  for (const elapsed of [0, 16_000]) {
    const s = setup()
    s.deps.stories = async () => { s.advance(elapsed); return 0 }
    await s.run()
    assert.equal(s.context.budget.used.stories, 0)
    assert.ok(s.calls.includes('content'))
    assert.equal(s.now(), s.context.deadline)
  }
})

test('outreach and cleanup use the same deadline, budget and seen sets as content', async () => {
  const s = setup()
  let state: FeedState | undefined
  s.deps.content = async (_page, end, _config, budget, shared) => {
    if (state) assert.equal(shared, state)
    state = shared; assert.equal(budget, s.context.budget); s.advance(end - s.now()); budget.browsed++
    return 'finished'
  }
  await s.run(async session => {
    assert.equal(session.remainingMinutes, 19)
    assert.equal(session.deadline, s.context.deadline)
    let guarded = false
    s.deps.waitForOutreach = async (_page, until, config, parent) => {
      guarded = true; assert.equal(config, s.context.config); assert.equal(parent.end, session.deadline)
      assert.equal(until, s.now() + 1000); s.advance(1000); return true
    }
    assert.equal(await session.waitForOutreach!(s.now() + 1000), true)
    assert.ok(guarded)
    s.calls.push('unfollow')
    await session.browse(1); s.calls.push('follow'); s.advance(30_000)
    await session.browse(1); s.calls.push('dm'); s.advance(30_000)
    return session.browse((session.deadline - s.now()) / 60_000)
  })
  assert.ok(state); assert.equal(s.now(), s.context.deadline)
})

test('temporary empty views retry without another startup or Story phase', async () => {
  const s = setup(), content = s.deps.content
  let tries = 0
  s.deps.content = async (...args) => {
    if (++tries === 1) { s.advance(5000); return 'stalled' }
    return content(...args)
  }
  assert.equal(await s.run(), 'finished')
  assert.equal(tries, 2); assert.equal(s.calls.filter(call => call === 'stories').length, 1)
})

test('using the whole final browsing budget without a completed view finishes normally', async () => {
  const s = setup()
  s.deps.content = async (_page, end) => { s.advance(end - s.now()); return 'finished' }
  assert.equal(await s.run(), 'finished')
  assert.equal(s.context.budget.browsed, 0)
  assert.equal(s.now(), s.context.deadline)
})

for (const endsAtBudget of [false, true]) test(`a content surface with no completed view distinguishes early stalls from budget expiry (${endsAtBudget})`, async () => {
  let now = Date.now()
  const end = now + 10_000
  const budget = new WarmupActivityBudget({ likes: 0, profiles: 0, reels: 0, stories: 0 })
  const deps = { now: () => now, random: (min: number) => min,
    openReels: async () => true,
    reels: async () => { if (endsAtBudget) { now = end; throw new SessionEnded() } },
    home: async () => 'finished' as const,
  }
  const state: FeedState = { next: 'reels', homeSeen: new Set(), reelsSeen: new Set() }
  assert.equal(await browseContent({} as Page, end, { browse_home_feed: false }, budget, state, () => {}, () => false, deps),
    endsAtBudget ? 'finished' : 'stalled')
})

test('topic following lives in the browsing flow and never owns post likes', async () => {
  const s = setup(3)
  s.context.config = { warmup_topics: ['Fishing'], watch_stories: false }
  s.deps.follow = async (_page, topics, budget, session, request, _log, _deps, interlude, terms) => {
    assert.deepEqual(topics, ['Fishing']); assert.deepEqual(terms, ['fishing'])
    assert.equal(request, s.context.request); assert.ok(session.end < s.context.deadline)
    s.calls.push('follow'); assert.equal(budget.take('follows'), true)
    assert.ok(await interlude!()); assert.equal(budget.used.likes, 0)
  }
  await s.run()
  assert.deepEqual(s.calls.filter(call => call !== 'check'), ['notifications', 'inbox', 'home', 'follow', 'content', 'content'])
})

for (const [home, reels] of [[true, true], [true, false], [false, true], [false, false]])
  test(`sibling content routing respects Home=${home} Reels=${reels} and time limits`, async () => {
    let now = Date.now()
    const end = now + 180_000, calls: string[] = []
    const budget = new WarmupActivityBudget({ likes: 0, profiles: 0, reels: 0, stories: 0 })
    const state: FeedState = { next: 'home', homeSeen: new Set(), reelsSeen: new Set() }
    const deps: NonNullable<Parameters<typeof browseContent>[7]> = {
      now: () => now, random: min => min,
      home: async (_page, session, _config, _log, shared, _matcher, seen) => {
        assert.equal(currentUiDiagnosticContext()?.session, session)
        assert.equal(currentUiDiagnosticContext()?.stage, 'browse_home')
        assert.ok(home); assert.equal(shared, budget); assert.equal(seen, state.homeSeen)
        calls.push('home'); now = session.end; budget.browsed++; return 'finished'
      },
      openReels: async () => { assert.ok(reels); calls.push('open-reels'); return true },
      reels: async (_page, session, _config, _log, shared, _matcher, seen) => {
        assert.equal(currentUiDiagnosticContext()?.session, session)
        assert.equal(currentUiDiagnosticContext()?.stage, 'browse_reels')
        assert.ok(session.end <= end)
        assert.equal(shared, budget); assert.equal(seen, state.reelsSeen)
        calls.push('reels'); now = session.end; budget.used.reels += 10; budget.browsed++
      },
    }
    const result = await browseContent({} as Page, end, { browse_home_feed: home, scroll_reels: reels }, budget, state,
      () => {}, () => false, deps)
    assert.equal(result, home || reels ? 'finished' : 'skipped')
    assert.equal(calls.includes('home'), home); assert.equal(calls.includes('reels'), reels)
    if (home || reels) assert.equal(now, end)
  })

test('failed Reels opening falls back to enabled Home feed, while account warnings propagate', async () => {
  const budget = new WarmupActivityBudget({ likes: 0, profiles: 0, reels: 0, stories: 0 })
  let now = Date.now(), homes = 0
  const end = now + 180_000
  const deps = { now: () => now, random: (min: number) => min, openReels: async () => false,
    home: async (_page: Page, session: { end: number }) => { homes++; now = session.end; budget.browsed++; return 'finished' as const },
    reels: async () => { throw new Error('An unopened viewer must not be used') },
  }
  const state: FeedState = { next: 'reels', homeSeen: new Set(), reelsSeen: new Set() }
  assert.equal(await browseContent({} as Page, end, {}, budget, state, () => {}, () => false, deps), 'finished')
  assert.ok(homes > 0)
  deps.home = async () => { throw new Error('Instagram checkpoint needs attention') }
  now = end - 60_000
  await assert.rejects(browseContent({} as Page, end, {}, budget, state, () => {}, () => false, deps), /checkpoint/)
})

test('a content slice expiry does not stop the entire browsing session', async () => {
  let now = Date.now()
  const end = now + 180_000
  const budget = new WarmupActivityBudget({ likes: 0, profiles: 0, reels: 0, stories: 0 })
  const state: FeedState = { next: 'reels', homeSeen: new Set(), reelsSeen: new Set() }
  const deps = { now: () => now, random: (min: number) => min, openReels: async () => true,
    reels: async (_page: Page, session: { end: number }) => {
      budget.browsed++; now = session.end; throw new SessionEnded()
    },
    home: async (_page: Page, session: { end: number }) => { budget.browsed++; now = session.end; return 'finished' as const },
  }
  assert.equal(await browseContent({} as Page, end, {}, budget, state, () => {}, () => false, deps), 'finished')
  assert.equal(now, end)
})
