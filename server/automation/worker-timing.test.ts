import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RuntimeSnapshot } from '../shared/convexRealtime.js'
import {
  MAX_REALTIME_SLEEP_MS,
  loadFullRuntimeSnapshot,
  msUntilMidnightUtc,
  nextWakeupDelayMs,
  routineMayRun,
} from './worker.js'

test('routine prefilter skips rest and spent budgets, then allows the next UTC day', () => {
  const now = Date.parse('2026-09-24T12:00:00Z')
  const snapshot: RuntimeSnapshot = { automation: {}, profiles: [],
    warmups: [{ profileId: 'p', date: '2026-09-24', todayMinutes: 30, minutesUsedToday: 30 }], progress: [] }
  assert.equal(routineMayRun(snapshot, 'p', now), false)
  assert.equal(routineMayRun(snapshot, 'p', now + 86_400_000), true)
  snapshot.warmups![0]!.minutesUsedToday = 10
  snapshot.warmups![0]!.activeRun = true
  assert.equal(routineMayRun(snapshot, 'p', now), false)
  snapshot.warmups![0]!.activeRun = false
  snapshot.progress = [{ profileId: 'p', nextRunAt: now + 60_000 }]
  assert.equal(routineMayRun(snapshot, 'p', now), false)
  assert.equal(routineMayRun(snapshot, 'p', now + 60_000), true)
  snapshot.progress = [{ profileId: 'p', paused: true }]
  assert.equal(routineMayRun(snapshot, 'p', now), false)
  snapshot.progress = [{ profileId: 'p', issue: 'review' }]
  assert.equal(routineMayRun(snapshot, 'p', now), false)
})

test('midnight is always a wakeup candidate', () => {
  const now = Date.UTC(2026, 8, 21, 12, 0, 0)
  assert.equal(msUntilMidnightUtc(now), 12 * 60 * 60 * 1000)
  const delay = nextWakeupDelayMs(null, 0, now)
  assert.ok(delay > 0 && delay <= MAX_REALTIME_SLEEP_MS)
})

test('cooldown expiry shortens the sleep', () => {
  const now = Date.UTC(2026, 8, 21, 12, 0, 0)
  const snapshot: any = {
    automation: { status: 'running', isActive: true },
    profiles: [{ id: 'p1', lastOpenedAt: now - 25 * 60_000 }],
    warmups: [],
    progress: [],
  }
  // 30 min cooldown with 25 min elapsed -> ~5 min left.
  const delay = nextWakeupDelayMs(snapshot, 30, now)
  assert.ok(delay > 4 * 60_000 && delay <= 5 * 60_000 + 1000)
})

test('warmup and progress rest periods wake the loop', () => {
  const now = Date.now()
  const snapshot: any = {
    automation: { status: 'running', isActive: true },
    profiles: [{ id: 'p1' }],
    warmups: [{ profileId: 'p1', nextRunAt: now + 2 * 60_000 }],
    progress: [{ profileId: 'p1', nextRunAt: now + 60_000 }],
  }
  const delay = nextWakeupDelayMs(snapshot, 0, now)
  assert.ok(delay > 0 && delay <= 60_000 + 1000)
})

test('long sleeps are capped so a missed update never sleeps forever', () => {
  const now = Date.UTC(2026, 8, 21, 0, 0, 1)
  const snapshot: any = {
    automation: { status: 'running', isActive: true },
    profiles: [],
    warmups: [{ profileId: 'p1', nextRunAt: now + 10 * 60 * 60_000 }],
    progress: [],
  }
  assert.equal(nextWakeupDelayMs(snapshot, 0, now), MAX_REALTIME_SLEEP_MS)
})

test('truncated snapshots sweep every list cursor so no profile starves', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    const u = String(url)
    assert.match(u, /runtime-page/)
    const params = new URL(u).searchParams
    assert.equal(params.get('listId'), 'list')
    if (!params.get('cursor')) {
      return Response.json({
        automation: { status: 'running', isActive: true },
        profiles: [{ id: 'p1', name: 'p1' }],
        warmups: [{ profileId: 'p1', nextRunAt: 0 }],
        progress: [{ profileId: 'p1', nextRunAt: 0 }],
        nextCursor: 'c1',
        isDone: false,
      })
    }
    assert.equal(params.get('cursor'), 'c1')
    return Response.json({
      automation: { status: 'running', isActive: true },
      profiles: [{ id: 'p2', name: 'p2' }],
      warmups: [{ profileId: 'p2', nextRunAt: 0 }],
      progress: [{ profileId: 'p2', nextRunAt: 0 }],
      nextCursor: null,
      isDone: true,
    })
  }) as typeof fetch
  try {
    const full = await loadFullRuntimeSnapshot('auto', ['list'], {
      automation: { status: 'running', isActive: true },
      profiles: [{ id: 'p0', name: 'p0' }],
      warmups: [{ profileId: 'p0', nextRunAt: 0 }],
      progress: [{ profileId: 'p0', nextRunAt: 0 }],
      truncated: true,
    })
    assert.deepEqual(full.profiles.map((p: any) => p.id), ['p0', 'p1', 'p2'])
    assert.equal(full.truncated, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})
