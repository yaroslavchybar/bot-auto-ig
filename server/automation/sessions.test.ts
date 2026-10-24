import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { runBrowsingSession, sessionConfig } from './sessions.js'
import { SessionEnded } from './actions/session.js'
import { browsingNumbers, browsingFlags } from '../shared/browsingSettings.js'
import { defaultRoutine, validateRoutine } from '../../convex/routinePolicy.js'
import { logOperation } from '../shared/logger.js'

test('routine validation and session defaults share one browsing policy', () => {
  const config = sessionConfig({})
  for (const [key, rule] of Object.entries(browsingNumbers)) {
    assert.equal(config[key as keyof typeof browsingNumbers], rule.default)
    assert.throws(() => validateRoutine({ ...defaultRoutine, activity: { [key]: rule.max + 1 } }))
  }
  for (const [key, value] of Object.entries(browsingFlags)) {
    assert.equal(config[key as keyof typeof browsingFlags], value)
  }
})

function setup(day = 8, minutes = 10) {
  let now = Date.parse('2026-10-14T12:00:00Z')
  const calls: string[] = [], finishes: any[] = []
  let url = 'https://www.instagram.com/'
  const page = { url: () => url, goto: async (target: string, options: { waitUntil: string; timeout: number }) => {
    assert.equal(target, 'https://www.instagram.com/')
    assert.equal(options.waitUntil, 'domcontentloaded')
    assert.ok(options.timeout > 0 && options.timeout <= 15_000)
    calls.push('home'); url = target; return null
  } } as unknown as Page
  const deps: NonNullable<Parameters<typeof runBrowsingSession>[6]> = {
    now: () => now,
    begin: async () => ({ date: '2026-10-14', minutes, remainingMinutes: 20, day,
      activityPlan: { likes: 4, profiles: 3, follows: 2, reels: 0, stories: 0, saves: 1, comments: 1 } }),
    finish: async input => { finishes.push(input) },
    check: async () => { calls.push('check') },
    appearance: async () => {},
    unseenStories: async () => false,
    explore: async (_page, end, config, budget) => {
      if (day > 4 || !config.warmup_topics || !(config.warmup_topics as string[]).length) return
      calls.push('explore'); assert.equal(end - now, minutes * 60_000 * 0.3)
      budget.take('likes'); now = end
    },
    browse: async (_page, context) => {
      calls.push('browse'); assert.equal(context.deadline, Date.parse('2026-10-14T12:00:00Z') + minutes * 60_000)
      assert.equal(context.request.profileId, 'profile'); assert.equal(context.request.date, '2026-10-14')
      context.budget.used.reels += 12; context.budget.used.stories += 7
      now = context.deadline; return 'finished'
    },
  }
  const run = async (input: Record<string, unknown> = {}, stopped = () => false) => {
    const originalNow = Date.now
    Date.now = () => now
    try { return await runBrowsingSession('profile', 'automation', input, page, () => {}, stopped, deps) }
    finally { Date.now = originalNow }
  }
  return { run, deps, calls, finishes, page, startAt: (path: string) => { url = `https://www.instagram.com${path}` },
    advance: (ms: number) => { now += ms } }
}

test('session reserves once, runs Explore before browsing, and accounts for both phases', async () => {
  const s = setup(3)
  assert.deepEqual(await s.run({ warmup_topics: ['Fishing'] }), { minutes: 10, reason: 'finished' })
  assert.deepEqual(s.calls, ['check', 'explore', 'browse'])
  assert.equal(s.finishes.length, 1)
  assert.equal(s.finishes[0].minutes, 10)
  assert.equal(s.finishes[0].activity.likes, 1)
  assert.equal(s.finishes[0].activity.reels, 12)
  assert.equal(s.finishes[0].activity.stories, 7)
})

test('failed reservation persistence keeps completed browsing metrics', async () => {
  const s = setup(3)
  s.deps.finish = async () => { throw new Error('Reservation save failed') }
  await assert.rejects(logOperation('automation.profile_session', {}, async scope => {
    try { await s.run({ warmup_topics: ['Fishing'] }) }
    finally {
      assert.equal(scope.fields.browsingMinutes, 10)
      assert.equal((scope.fields.activityAttempts as Record<string, number>).likes, 1)
      assert.equal(typeof scope.fields.runId, 'string')
      assert.equal(scope.fields.warmupDay, 3)
    }
  }), /Reservation save failed/)
})

test('startup receives the reserved proxy timezone and sets appearance before Stories or browsing', async () => {
  const s = setup(8), begin = s.deps.begin
  s.deps.begin = async (...args) => ({ ...await begin(...args), timezone: 'America/New_York' })
  s.deps.appearance = async (_page, timezone, session) => {
    assert.equal(timezone, 'America/New_York')
    assert.equal(session.end, Date.parse('2026-10-14T12:10:00Z'))
    assert.deepEqual(s.calls, ['check']); s.calls.push('appearance')
  }
  s.deps.unseenStories = async () => { assert.ok(s.calls.includes('appearance')); return false }
  await s.run()
  assert.ok(s.calls.indexOf('appearance') < s.calls.indexOf('browse'))
})

test('initial unseen Stories are detected before Explore and retained for startup navigation', async () => {
  const s = setup(3)
  s.deps.unseenStories = async (_page, session) => {
    assert.ok(!s.calls.includes('explore'))
    assert.equal(session.end, Date.parse('2026-10-14T12:10:00Z'))
    s.calls.push('detect-stories')
    return true
  }
  const browse = s.deps.browse
  s.deps.browse = async (...args) => {
    assert.equal(args[1].unseenStories, true)
    assert.ok(s.calls.includes('explore'))
    return browse(...args)
  }
  await s.run({ warmup_topics: ['Fishing'], browse_home_feed: false })
  assert.deepEqual(s.calls, ['check', 'detect-stories', 'explore', 'browse'])
})

for (const path of ['/reels/current/', '/direct/inbox/'])
  test(`startup from ${path} navigates Home before checking unseen Stories`, async () => {
    const s = setup(3)
    s.startAt(path)
    s.deps.unseenStories = async page => {
      assert.equal(page.url(), 'https://www.instagram.com/')
      assert.deepEqual(s.calls, ['check', 'home', 'check'])
      s.calls.push('detect-stories'); return true
    }
    const browse = s.deps.browse
    s.deps.browse = async (...args) => {
      assert.equal(args[1].unseenStories, true)
      return browse(...args)
    }
    await s.run({ warmup_topics: ['Fishing'], browse_home_feed: false })
    assert.deepEqual(s.calls, ['check', 'home', 'check', 'detect-stories', 'explore', 'browse'])
  })

test('disabled Stories skip initial detection and pass no unseen Stories to browsing', async () => {
  const s = setup()
  s.startAt('/reels/current/')
  s.deps.unseenStories = async () => { throw new Error('Stories disabled') }
  s.deps.browse = async (_page, context) => {
    assert.equal(context.unseenStories, false)
    return 'finished'
  }
  await s.run({ watch_stories: false })
  assert.ok(!s.calls.includes('home'))
})

test('day one and blank interests have no interaction allowance', async () => {
  for (const [day, interests] of [[1, ['Fishing']], [8, []]] as const) {
    const s = setup(day)
    s.deps.browse = async (_page, context) => {
      for (const kind of ['likes', 'follows', 'saves', 'comments'] as const) assert.equal(context.budget.take(kind), false)
      return 'finished'
    }
    await s.run({ warmup_topics: interests })
  }
})

test('resting sessions never launch either phase or finish an unreserved run', async () => {
  const s = setup(8, 0)
  assert.equal((await s.run()).reason, 'skipped')
  assert.deepEqual(s.calls, []); assert.deepEqual(s.finishes, [])
})

test('a stopped session releases its reservation without navigating', async () => {
  const s = setup()
  assert.deepEqual(await s.run({}, () => true), { minutes: 0, reason: 'stopped' })
  assert.deepEqual(s.calls, []); assert.equal(s.finishes.length, 1)
})

for (const elapsed of [30_000, 600_000]) test(`stalled sessions preserve their result and charge elapsed time (${elapsed}ms)`, async () => {
  const s = setup()
  s.deps.browse = async () => { s.advance(elapsed); return 'stalled' }
  await logOperation('automation.profile_session', {}, async scope => {
    assert.deepEqual(await s.run(), { minutes: elapsed / 60_000, reason: 'stalled' })
    assert.equal(scope.fields.outcome, 'error')
    assert.equal(scope.fields.sessionReason, 'stalled')
  })
  assert.equal(s.finishes.length, 1)
  assert.equal(s.finishes[0].minutes, elapsed / 60_000)
})

for (const phase of ['explore', 'browse'] as const) test(phase + ' failures preserve elapsed time and propagate', async () => {
  const s = setup(3)
  s.deps[phase] = async () => { s.advance(30_000); throw new Error('Browser disconnected') }
  await assert.rejects(s.run({ warmup_topics: ['Fishing'] }), /Browser disconnected/)
  assert.equal(s.finishes.length, 1)
  assert.equal(s.finishes[0].minutes, phase === 'explore' ? 0.5 : 3.5)
})

test('account warnings stop before Explore or browsing', async () => {
  const s = setup()
  s.deps.check = async () => { throw new Error('Instagram checkpoint needs attention') }
  await assert.rejects(s.run(), /checkpoint/)
  assert.equal(s.finishes[0].minutes, 0)
})

test('both phases and outreach share the reserved UTC-day deadline', async () => {
  const s = setup()
  let now = Date.parse('2026-10-14T23:59:00Z')
  s.deps.now = () => now
  s.deps.explore = async (_page, end) => { assert.equal(end, now + 18_000); now = end }
  s.deps.browse = async (_page, context, _log, _stop, activity, notifications) => {
    assert.equal(context.deadline, Date.parse('2026-10-15T00:00:00Z'))
    assert.equal(context.remainingMinutes, 0.7)
    assert.ok(activity); assert.ok(notifications)
    now = context.deadline; throw new SessionEnded()
  }
  const result = await runBrowsingSession('profile', 'automation', {}, s.page, () => {}, () => false, s.deps,
    async () => 'finished', async () => {})
  assert.deepEqual(result, { minutes: 1, reason: 'finished' })
  assert.equal(s.finishes.length, 1)
})

test('configuration contains only time, interests and enabled surfaces', () => {
  const config = sessionConfig({ warmup_min_minutes: 0, warmup_max_minutes: -1,
    warmup_topics: ' Fishing, excluding hunting ', browse_home_feed: false })
  assert.equal(config.warmup_min_minutes, 1); assert.equal(config.warmup_max_minutes, 1)
  assert.deepEqual(config.warmup_topics, ['Fishing, excluding hunting'])
  assert.equal(config.browse_home_feed, false); assert.equal(config.scroll_reels, true)
  assert.equal(config.watch_stories, true)
  for (const key of ['soft_warmup', 'like_chance', 'follow_chance', 'stories_max', 'stories_min_view_seconds',
    'post_view_max_seconds', 'skip_post_chance', 'skip_post_max', 'reels_min', 'reels_max', 'reels_chance',
    'carousel_watch_chance', 'carousel_max_slides', 'own_profile_chance', 'profile_visit_chance', 'dm_chance'])
    assert.equal(key in sessionConfig({ [key]: 999 }), false)
})
