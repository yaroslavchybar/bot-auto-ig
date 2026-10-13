import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { runWarmup, warmupConfig, warmupReady } from './warmup.js'
import { scheduleRoutine } from './routine-schedule.js'
import { watchStories } from './actions/stories.js'

function setup(minutes = 40) {
  let now = Date.parse('2026-09-19T12:00:00Z')
  const recorded: number[] = []
  const calls: string[] = []
  const deps: NonNullable<Parameters<typeof runWarmup>[6]> = {
    begin: async () => ({ date: '2026-09-19', minutes, day: 8,
      activityPlan: { likes: 6, profiles: 4, reels: 20, stories: 3 } }),
    finish: async (input: { minutes: number }) => { recorded.push(input.minutes) },
    feed: async (_page, minutes, _config, _log, _stop, budget) => { calls.push('feed'); now += minutes * 60_000; if (budget) budget.browsed++; return 'finished' as const },
    stories: async (_page, count) => { calls.push('stories'); now += 60_000; return count },
    now: () => now, sleep: async ms => { now += ms },
    check: async () => {}, notifications: async () => false, inbox: async () => false, home: async () => {},
    topics: async (_page, end, _config, budget) => { now = end; budget.browsed++; return 'finished' },
    engage: async () => {},
    searchTerms: async () => ['strength training'],
  }
  const run = (config = {}) => runWarmup('profile', 'automation', config, {} as Page, () => {}, () => false, deps)
  return { deps, calls, recorded, run }
}

test('records elapsed time instead of the planned duration, including stories', async () => {
  const { run, calls, recorded, deps } = setup()
  const feed = deps.feed
  deps.feed = async (page, _minutes, ...rest) => { await feed(page, 5, ...rest); return 'stopped' }
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

test('standalone warm-up retries a short stall within the original reservation', async () => {
  const s = setup(10)
  const feed = s.deps.feed
  let tries = 0
  s.deps.feed = async (page, minutes, ...rest) => {
    if (++tries === 1) { await s.deps.sleep(30_000); return 'stalled' }
    return feed(page, minutes, ...rest)
  }
  const result = await s.run({ watch_stories: false })
  assert.equal(tries, 2)
  assert.equal(result.reason, 'finished')
  assert.equal(result.minutes, 9.8)
  assert.deepEqual(s.recorded, [9.8])
})

test('a story opening chunk expiry retries browsing instead of completing the whole session', async () => {
  const originalNow = Date.now
  const s = setup(10)
  let now = s.deps.now(), browses = 0
  Date.now = () => now
  s.deps.now = () => now
  s.deps.sleep = async ms => { now += ms }
  s.deps.stories = watchStories
  s.deps.feed = async (_page, minutes, _config, _log, _stop, budget) => {
    browses++; now += minutes * 60_000; if (budget) budget.browsed++
    return 'finished'
  }
  const story = { first() { return this }, waitFor: async () => {},
    isVisible: async () => { now += 11_000; return true },
    elementHandle: async () => { throw new Error('Expired story must not be clicked') },
  }
  const page = { goto: async () => {}, url: () => 'https://www.instagram.com/',
    keyboard: { press: async () => {} },
    locator: (selector: string) => selector.includes('Story by') ? story : { count: async () => 0 },
  } as unknown as Page
  try {
    const result = await runWarmup('profile', 'automation', {}, page, () => {}, () => false, s.deps,
      async session => {
        assert.equal(await session.browse(10 / 60), 'stalled')
        return session.browse((session.deadline - now) / 60_000)
      })
    assert.equal(browses, 1)
    assert.equal(result.reason, 'finished')
    assert.equal(result.minutes, 9.8)
  } finally { Date.now = originalNow }
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
    return 'stopped'
  }
  await s.run({ browse_home_feed: false, watch_stories: false })
  assert.deepEqual(s.calls, ['reels-only'])
})

test('soft warm-up forces passive settings even when saved engagement chances are enabled', () => {
  const config = warmupConfig({ soft_warmup: false, like_chance: 100, follow_chance: 100, warmup_topics: ' Fitness, gym, FITNESS,  ' })
  assert.equal('soft_warmup' in config, false)
  assert.equal('like_chance' in config, false)
  assert.equal('follow_chance' in config, false)
  assert.equal(config.warmup_topics, 'Fitness, gym, FITNESS,')
})

test('maintenance enables its shared like budget without restoring a mode toggle', async () => {
  const s = setup()
  s.deps.feed = async (_p, _m, config, _l, _s, budget) => {
    assert.equal('soft_warmup' in config, false)
    assert.equal(budget?.plan.likes, 6)
    assert.equal(budget?.take('likes'), true)
    return 'stopped'
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

test('week-one engagement generates search terms with both browsing surfaces disabled', async () => {
  for (const day of [1, 2, 7, 8]) for (const description of ['', 'fitness']) for (const stopped of [false, true]) {
    const s = setup(10)
    const terms = ['strength training']
    let generations = 0, engagements = 0
    s.deps.begin = async () => ({ date: '2026-09-19', minutes: 10, day,
      activityPlan: { likes: 4, follows: 2, profiles: 2, reels: 18, stories: 0 } })
    s.deps.searchTerms = async input => {
      assert.equal(input, description); generations++
      return terms
    }
    s.deps.engage = async (_page, input, _budget, _session, _request, _log, _deps, _interlude, searchTerms) => {
      assert.equal(input, description)
      assert.equal(searchTerms, terms)
      engagements++
    }
    s.deps.feed = async () => { throw new Error('Home feed is disabled') }
    s.deps.topics = async () => { throw new Error('Both browsing surfaces are disabled') }
    await runWarmup('profile', 'automation', { warmup_topics: description, watch_stories: false,
      browse_home_feed: false, scroll_reels: false }, {} as Page, () => {}, () => stopped, s.deps)
    const expected = !stopped && description && day >= 2 && day <= 7 ? 1 : 0
    assert.equal(generations, expected)
    assert.equal(engagements, expected)
  }
})

test('topic warm-up uses the same daily budget and state across mixed browsing chunks', async () => {
  const s = setup()
  let generations = 0
  const description = 'Fitness training, excluding competitions'
  s.deps.searchTerms = async input => {
    assert.equal(input, description); generations++
    return ['strength training', 'home workouts']
  }
  const states: unknown[] = [], budgets: unknown[] = []
  s.deps.topics = async (_p, _end, config, budget, state) => {
    assert.equal('soft_warmup' in config, false)
    assert.equal('like_chance' in config, false)
    assert.equal(budget.plan.likes, 6)
    assert.equal(config.warmup_topics, description)
    assert.deepEqual(state.searchTerms, ['strength training', 'home workouts'])
    states.push(state); budgets.push(budget)
    return 'finished'
  }
  await runWarmup('profile', 'automation', { warmup_topics: description, watch_stories: false }, {} as Page, () => {}, () => false, s.deps,
    async session => { await session.browse(1); await session.browse(1); return 'finished' })
  assert.equal(states.length, 2)
  assert.equal(generations, 1)
  assert.equal(states[0], states[1])
  assert.equal(budgets[0], budgets[1])
  assert.deepEqual(s.calls, [])
})

test('reels-only retries an incomplete Explore view and reaches outreach within its reservation', async () => {
  const s = setup(5)
  let now = s.deps.now(), browses = 0, follows = 0
  const order: string[] = []
  s.deps.now = () => now
  s.deps.feed = async () => { throw new Error('Home feed is disabled') }
  s.deps.topics = async (_page, end, config, budget) => {
    assert.equal(config.browse_home_feed, false)
    order.push('browse')
    if (++browses > 1) budget.browsed++
    now = end
    // The first view uses its chunk deadline without completing playback.
    return browses === 1 ? 'stopped' : 'finished'
  }
  const result = await runWarmup('profile', 'automation', {
    browse_home_feed: false, warmup_topics: 'fitness', watch_stories: false,
  }, {} as Page, () => {}, () => false, s.deps, async session => scheduleRoutine(session, {
    now: () => now, stopped: () => false, random: min => min, log: () => {},
    sleep: async ms => { now += ms },
    target: async () => ({ target: 5, remaining: 5 - follows, sent: follows }),
    send: async () => { follows++; order.push('follow'); now += 10_000; return 'followed' },
  }))
  assert.deepEqual(order.slice(0, 3), ['browse', 'browse', 'follow'])
  assert.ok(follows > 0)
  assert.equal(result.reason, 'finished')
  assert.ok(result.minutes <= 5)
})

test('mixed browsing distinguishes temporary empty views from disabled or exhausted surfaces', async () => {
  for (const unavailable of ['empty', 'disabled', 'exhausted']) {
    const s = setup()
    s.deps.topics = async () => 'finished'
    s.deps.begin = async () => ({ date: '2026-09-19', minutes: 10, day: 8,
      activityPlan: { likes: 0, profiles: 0, reels: unavailable === 'exhausted' ? 0 : 20, stories: 0 } })
    const result = await runWarmup('profile', 'automation', {
      browse_home_feed: false, scroll_reels: unavailable !== 'disabled', watch_stories: false,
    }, {} as Page, () => {}, () => false, s.deps, async session => {
      const reason = await session.browse(1)
      assert.equal(reason, unavailable === 'empty' ? 'stalled' : 'skipped')
      return reason
    })
    assert.equal(result.reason, unavailable === 'empty' ? 'stalled' : 'skipped')
  }
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
    return 'stopped'
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
    return 'stopped'
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
