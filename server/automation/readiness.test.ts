import test from 'node:test'
import assert from 'node:assert/strict'
import { loadFullRuntimeSnapshot, routineDueAt } from './readiness.js'
import { readFileSync } from 'node:fs'

test('worker and native scheduler follow the same readiness contract', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../tests/server/runtime-readiness.json', import.meta.url), 'utf8'))
  for (const row of fixture.cases) {
    const snapshot = { automation: { isActive: true }, profiles: [{ id: 'p', ...row.profile }],
      progress: row.progress ? [{ profileId: 'p', ...row.progress }] : [],
      warmups: row.warmup ? [{ profileId: 'p', ...row.warmup }] : [] }
    assert.equal(routineDueAt(snapshot, fixture.now), fixture.now + row.delay, row.name)
  }
})

test('fractional stored deadlines yield integer wakeups without shortening rest', () => {
  const now = Date.parse('2026-10-09T12:00:00Z')
  const snapshot = {
    automation: { isActive: true },
    profiles: [{ id: 'p', igLoggedIn: true, inUse: false }],
    progress: [{ profileId: 'p', nextRunAt: now + 30_000.25 }],
    warmups: [{ profileId: 'p', nextRunAt: now + 30_000.75 }],
  }
  assert.equal(routineDueAt(snapshot, now), now + 30_001)
})

test('routine wakeups honor rest, login, daily budgets and paused profiles', () => {
  const now = Date.parse('2026-09-30T23:55:00Z')
  const automation = { isActive: true }
  const ready = { id: 'ready', igLoggedIn: true, inUse: false }
  assert.equal(routineDueAt({ automation, profiles: [ready], progress: [{ profileId: 'ready', nextRunAt: now + 30_000 }] }, now), now + 30_000)
  for (const blocked of [
    { ...ready, paused: true }, { ...ready, igLoggedIn: false }, { ...ready, inUse: true }, { ...ready, pendingRenameFrom: 'old' },
    { ...ready, igAccountStatus: 'assigned', browserLoggedInAt: now - 1000 },
  ]) assert.equal(routineDueAt({ automation, profiles: [blocked] }, now), now + 15 * 60_000)
  assert.equal(routineDueAt({ automation, profiles: [{ ...ready, paused: true }], progress: [{ profileId: 'ready' }] }, now), now + 15 * 60_000)
  assert.equal(routineDueAt({ automation, profiles: [ready], warmups: [{ profileId: 'ready', date: '2026-09-30', todayMinutes: 10, minutesUsedToday: 10 }] }, now), Date.parse('2026-10-01T00:00:00Z'))
  assert.equal(routineDueAt({ automation, profiles: [{ ...ready, igAccountStatus: 'assigned', browserLoggedInAt: now - 24 * 60 * 60_000 }] }, now), now)
})

test('runtime expansion uses the latest duplicate rows', async () => {
  const first = { automation: {}, profiles: [{ id: 'p', paused: false }], warmups: [{ profileId: 'p', nextRunAt: 0 }], progress: [] }
  const result = await loadFullRuntimeSnapshot('a', ['m'], first, async () => ({
    profiles: [{ id: 'p', paused: true }], warmups: [{ profileId: 'p', nextRunAt: 50 }],
    progress: [], isDone: true, nextCursor: null,
  }))
  assert.deepEqual(result.profiles, [{ id: 'p', paused: true }])
  assert.equal(result.warmups?.[0].nextRunAt, 50)
})

for (const kind of ['missing page', 'missing cursor', 'repeated cursor', 'cursor cycle', 'page limit'] as const) {
  test(`runtime expansion rejects ${kind} instead of reporting a complete snapshot`, async () => {
    let pages = 0
    const fetch = async () => {
      pages++
      if (kind === 'missing page') return null
      return { profiles: [], isDone: false, nextCursor: kind === 'missing cursor' ? null
        : kind === 'repeated cursor' ? 'repeat' : kind === 'cursor cycle' ? String(pages % 2) : String(pages) }
    }
    await assert.rejects(loadFullRuntimeSnapshot('a', ['m'], null, fetch), /Runtime/)
    assert.ok(pages <= 500)
  })
}
