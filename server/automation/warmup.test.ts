import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { runWarmup, warmupConfig, warmupReady } from './warmup.js'

function setup(minutes = 40) {
  let now = Date.parse('2026-09-19T12:00:00Z')
  const recorded: number[] = []
  const calls: string[] = []
  const deps: NonNullable<Parameters<typeof runWarmup>[6]> = {
    begin: async () => ({ date: '2026-09-19', minutes }),
    finish: async (input: { minutes: number }) => { recorded.push(input.minutes) },
    feed: async () => { calls.push('feed'); now += 5 * 60_000; return 'stalled' as const },
    stories: async () => { calls.push('stories'); now += 60_000 },
    now: () => now,
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
  const config = warmupConfig({ warmup_min_minutes: 0, warmup_max_minutes: -1, like_chance: NaN })
  assert.equal(config.warmup_min_minutes, 1)
  assert.equal(config.warmup_max_minutes, 1)
  assert.equal(config.like_chance, 10)
  assert.equal(config.watch_stories, false)
})

test('passes story timing settings and subtracts story time from the feed budget', async () => {
  const { deps, run } = setup(10)
  const originalStories = deps.stories
  deps.stories = async (...args) => {
    assert.equal(args[4]?.minSeconds, 3)
    assert.equal(args[4]?.maxSeconds, 7)
    await originalStories(...args)
  }
  deps.feed = async (_page, minutes) => {
    assert.equal(minutes, 9)
    return 'finished'
  }
  await run({ watch_stories: true, stories_min_view_seconds: 3, stories_max_view_seconds: 7 })
})

test('limits a session to the UTC day it reserved', async () => {
  const { deps, run } = setup(40)
  deps.now = () => Date.parse('2026-09-19T23:59:00Z')
  deps.feed = async (_page, minutes) => {
    assert.equal(minutes, 1)
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
