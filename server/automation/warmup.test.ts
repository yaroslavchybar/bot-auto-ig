import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { runWarmup, warmupConfig, warmupReady } from './warmup.js'

function setup(minutes = 40) {
  let now = Date.parse('2026-09-19T12:00:00Z')
  const recorded: number[] = []
  const calls: string[] = []
  const deps: NonNullable<Parameters<typeof runWarmup>[6]> = {
    begin: async () => ({ date: '2026-09-19', minutes, day: 8,
      activityPlan: { likes: 6, profiles: 4, reels: 20, stories: 3 } }),
    finish: async (input: { minutes: number }) => { recorded.push(input.minutes) },
    feed: async () => { calls.push('feed'); now += 5 * 60_000; return 'stalled' as const },
    stories: async (_page, count) => { calls.push('stories'); now += 60_000; return count },
    now: () => now,
    check: async () => {}, notifications: async () => false, inbox: async () => false, home: async () => {},
    topics: async () => 'finished',
    engage: async () => {},
  }
  const run = (config = {}) => runWarmup('profile', 'automation', config, {} as Page, () => {}, () => false, deps)
  return { deps, calls, recorded, run }
}

test('records elapsed time instead of the planned duration, including stories', async () => {
  const { run, calls, recorded } = setup()
  await run({ watch_stories: true })
  assert.deepEqual(calls, ['stories', 'feed'])
  assert.deepEqual(recorded, [6])
})

test('records elapsed time when browsing fails and propagates the failure', async () => {
  const { run, deps, recorded } = setup()
  deps.feed = async () => { throw new Error('navigation failed') }
  await assert.rejects(run({ watch_stories: true }), /navigation failed/)
  assert.deepEqual(recorded, [1])
})

test('mixed activity shares one reservation and counts DM time up to midnight', async () => {
  let now = Date.parse('2026-09-19T23:59:00Z');
  const s = setup();
  s.deps.now = () => now;
  s.deps.begin = async () => ({ date: '2026-09-19', minutes: 5, remainingMinutes: 10 });
  s.deps.feed = async (_page, minutes) => { now += minutes * 60_000; return 'finished'; };
  let notificationChecks = 0;
  s.deps.notifications = async () => { if (++notificationChecks === 2) now += 12_000; return true; };
  const result = await runWarmup('profile', 'automation', {}, {} as Page, () => {}, () => false, s.deps,
    async session => {
      assert.equal(session.remainingMinutes, 1);
      assert.equal(session.deadline, Date.parse('2026-09-20T00:00:00Z') - 12_000);
      await session.browse(0.25);
      now += 30_000; // DM preparation, pause and sending are inside the same reservation.
      await session.browse(5);
      return 'finished';
    });
  assert.deepEqual(result, { minutes: 1, reason: 'finished' });
  assert.deepEqual(s.recorded, [1]);
  assert.equal(notificationChecks, 2);
});

test('exhausted budget performs no browsing or recording', async () => {
  const { run, calls, recorded } = setup(0)
  await run({ watch_stories: true })
  assert.deepEqual(calls, [])
  assert.deepEqual(recorded, [])
})

test('budget read and write failures are never silently ignored', async () => {
  const failedRead = setup()
  failedRead.deps.begin = async () => { throw new Error('budget unavailable') }
  await assert.rejects(failedRead.run(), /budget unavailable/)
  assert.deepEqual(failedRead.calls, [])
  const failedWrite = setup()
  failedWrite.deps.finish = async () => { throw new Error('save failed') }
  await assert.rejects(failedWrite.run(), /save failed/)
})

test('normalizes the single warm-up config', () => {
  const config = warmupConfig({ soft_warmup: false, warmup_min_minutes: 0, warmup_max_minutes: -1, like_chance: NaN })
  assert.equal(config.warmup_min_minutes, 1)
  assert.equal(config.warmup_max_minutes, 1)
  assert.equal('like_chance' in config, false)
  assert.equal(config.watch_stories, true)
  assert.equal(config.browse_home_feed, true)
  assert.equal(config.scroll_reels, true)
  assert.equal('follow_chance' in warmupConfig({ follow_chance: 100 }), false)
})

test('home-feed and reels toggles normalize independently and route reels-only without keywords', async () => {
  assert.equal(warmupConfig({ browse_home_feed: false }).browse_home_feed, false)
  assert.equal(warmupConfig({ scroll_reels: false }).scroll_reels, false)
  const s = setup()
  s.deps.feed = async () => { throw new Error('Disabled home feed must not run') }
  s.deps.topics = async (_p, _end, config) => {
    assert.equal(config.browse_home_feed, false)
    assert.equal(config.scroll_reels, true)
    assert.equal(config.warmup_topics, '')
    s.calls.push('reels-only')
    return 'finished'
  }
  await s.run({ browse_home_feed: false, watch_stories: false })
  assert.deepEqual(s.calls, ['reels-only'])
})

test('soft warm-up forces passive settings even when saved engagement chances are enabled', () => {
  const config = warmupConfig({ soft_warmup: false, like_chance: 100, follow_chance: 100, warmup_topics: ' Fitness, gym, FITNESS,  ' })
  assert.equal('soft_warmup' in config, false)
  assert.equal('like_chance' in config, false)
  assert.equal('follow_chance' in config, false)
  assert.equal(config.warmup_topics, 'fitness,gym')
})

test('maintenance enables its shared like budget without restoring a mode toggle', async () => {
  const s = setup()
  s.deps.feed = async (_p, _m, config, _l, _s, budget) => {
    assert.equal('soft_warmup' in config, false)
    assert.equal(budget?.plan.likes, 6)
    assert.equal(budget?.take('likes'), true)
    return 'finished'
  }
  await s.run({ soft_warmup: false, watch_stories: false, like_chance: 100 })
})

test('only days 2–7 with keywords run the engagement phase, using the shared daily budget', async () => {
  for (const day of [1, 2, 7, 8]) for (const keywords of ['', 'fitness']) {
    const s = setup()
    let attempts = 0
    s.deps.begin = async () => ({ date: '2026-09-19', minutes: 10, day,
      activityPlan: { likes: 4, follows: 2, profiles: 2, reels: 18, stories: 0 } })
    s.deps.engage = async (_p, topics, budget, _session, request) => {
      assert.equal(topics, 'fitness'); assert.equal(request.profileId, 'profile')
      assert.ok(request.runId); assert.ok(budget.take('likes')); attempts++
    }
    await s.run({ warmup_topics: keywords, watch_stories: false })
    assert.equal(attempts, day >= 2 && day <= 7 && keywords ? 1 : 0)
  }
})

test('topic warm-up uses the same daily budget and state across mixed browsing chunks', async () => {
  const s = setup()
  const states: unknown[] = [], budgets: unknown[] = []
  s.deps.topics = async (_p, _end, config, budget, state) => {
    assert.equal('soft_warmup' in config, false)
    assert.equal('like_chance' in config, false)
    assert.equal(budget.plan.likes, 6)
    states.push(state); budgets.push(budget)
    return 'finished'
  }
  await runWarmup('profile', 'automation', { warmup_topics: 'fitness', watch_stories: false }, {} as Page, () => {}, () => false, s.deps,
    async session => { await session.browse(1); await session.browse(1); return 'finished' })
  assert.equal(states.length, 2)
  assert.equal(states[0], states[1])
  assert.equal(budgets[0], budgets[1])
  assert.deepEqual(s.calls, [])
})

test('checks notifications and inbox before activity and records attempts even on failure', async () => {
  const s = setup()
  const order: string[] = []
  let recorded: unknown
  s.deps.check = async () => { order.push('check') }
  s.deps.notifications = async () => { order.push('notifications'); return true }
  s.deps.inbox = async () => { order.push('inbox'); return true }
  s.deps.home = async () => { order.push('home') }
  s.deps.finish = async value => { recorded = value.activity }
  s.deps.feed = async (_p, _m, config, _l, _s, budget) => {
    order.push('feed')
    assert.equal('follow_chance' in config, false)
    assert.equal(budget?.take('likes'), true)
    assert.ok(budget?.take('profiles'))
    throw new Error('Instagram limit needs attention')
  }
  await assert.rejects(s.run({ soft_warmup: false, watch_stories: false, follow_chance: 100 }), /needs attention/)
  assert.deepEqual(order, ['check', 'notifications', 'inbox', 'home', 'check', 'feed'])
  assert.deepEqual(recorded, { likes: 1, profiles: 1, reels: 0, stories: 0, follows: 0, saves: 0, comments: 0 })
})

test('a visible Instagram warning stops before browsing or opening the inbox', async () => {
  const s = setup()
  s.deps.check = async () => { throw new Error('Instagram limit needs attention') }
  s.deps.inbox = async () => { throw new Error('Must not open inbox') }
  await assert.rejects(s.run(), /Instagram limit needs attention/)
  assert.deepEqual(s.calls, [])
  assert.deepEqual(s.recorded, [0])
})

test('mixed browsing chunks share activity ceilings and subtract inbox time from available minutes', async () => {
  const s = setup()
  let now = Date.parse('2026-09-19T12:00:00Z')
  const budgets: unknown[] = []
  s.deps.now = () => now
  s.deps.inbox = async () => { now += 60_000; return true }
  s.deps.begin = async () => ({ date: '2026-09-19', minutes: 10, remainingMinutes: 10, day: 2,
    activityPlan: { likes: 2, profiles: 2, reels: 18, stories: 0 } })
  s.deps.feed = async (_p, _m, _c, _l, _s, budget) => {
    budgets.push(budget)
    budget?.take('profiles')
    now += 60_000
    return 'finished'
  }
  await runWarmup('profile', 'automation', { soft_warmup: false, watch_stories: false }, {} as Page, () => {}, () => false, s.deps, async session => {
    assert.equal(session.remainingMinutes, 9)
    for (let i = 0; i < 3; i++) await session.browse(1)
    return 'finished'
  })
  assert.equal(budgets[0], budgets[1])
  assert.equal(budgets[1], budgets[2])
  assert.equal((budgets[0] as { used: { profiles: number } }).used.profiles, 2)
  assert.deepEqual(s.recorded, [4])
})

test('passes story timing settings and subtracts story time from the feed budget', async () => {
  const { deps, run } = setup(10)
  const originalStories = deps.stories
  deps.stories = async (...args) => {
    assert.equal(args[4]?.minSeconds, 3)
    assert.equal(args[4]?.maxSeconds, 7)
    return originalStories(...args)
  }
  deps.feed = async (_page, minutes) => {
    assert.equal(minutes, 8.8)
    return 'finished'
  }
  await run({ watch_stories: true, stories_min_view_seconds: 3, stories_max_view_seconds: 7 })
})

test('story budget records only watched stories, including absent trays and early stops', async () => {
  for (const watched of [0, 1, 3]) {
    const s = setup()
    let recordedStories = -1
    s.deps.stories = async (_page, count) => {
      assert.equal(count, 3)
      return watched
    }
    s.deps.feed = async (_page, _minutes, _config, _log, _stop, budget) => {
      assert.equal(budget?.used.stories, watched)
      assert.equal(budget?.remaining('stories'), 3 - watched)
      return 'finished'
    }
    s.deps.finish = async input => { recordedStories = input.activity?.stories ?? -1 }
    await s.run({ watch_stories: true })
    assert.equal(recordedStories, watched)
  }
})

test('limits a session to the UTC day it reserved', async () => {
  const { deps, run } = setup(40)
  deps.now = () => Date.parse('2026-09-19T23:59:00Z')
  deps.feed = async (_page, minutes) => {
    assert.equal(minutes, 0.8)
    return 'finished'
  }
  await run()
})

test('stopping before browsing releases the reservation without running actions', async () => {
  const { deps, calls, recorded } = setup()
  const result = await runWarmup('profile', 'automation', {}, {} as Page, () => {}, () => true, deps)
  assert.deepEqual(calls, [])
  assert.deepEqual(recorded, [0])
  assert.deepEqual(result, { reason: 'stopped', minutes: 0 })
})

test('only profiles with budget and completed rest are eligible to open', () => {
  const now = Date.parse('2026-09-19T12:00:00Z')
  const state = { date: '2026-09-19', todayMinutes: 40, minutesUsedToday: 10, reservedMinutes: 0 }
  assert.equal(warmupReady(null, now), true)
  assert.equal(warmupReady(state, now), true)
  assert.equal(warmupReady({ ...state, nextRunAt: now + 1 }, now), false)
  assert.equal(warmupReady({ ...state, reservedMinutes: 5 }, now), false)
  assert.equal(warmupReady({ ...state, minutesUsedToday: 40 }, now), false)
  assert.equal(warmupReady({ ...state, date: '2026-09-18', minutesUsedToday: 40 }, now), true)
  assert.equal(warmupReady({ ...state, date: '2026-09-18', nextRunAt: now + 1 }, now), false)
})
