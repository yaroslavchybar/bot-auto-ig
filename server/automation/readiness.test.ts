import test from 'node:test'
import assert from 'node:assert/strict'
import { routineDueAt } from './readiness.js'

test('routine wakeups honor rest, login, daily budgets and paused profiles', () => {
  const now = Date.parse('2026-09-30T23:55:00Z')
  const automation = { isActive: true }
  const ready = { id: 'ready', igLoggedIn: true, using: false }
  assert.equal(routineDueAt({ automation, profiles: [ready], progress: [{ profileId: 'ready', nextRunAt: now + 30_000 }] }, now), now + 30_000)
  for (const blocked of [
    { ...ready, igLoggedIn: false }, { ...ready, using: true }, { ...ready, renameFrom: 'old' },
    { ...ready, igAccountStatus: 'assigned', browserLoggedInAt: now - 1000 },
  ]) assert.equal(routineDueAt({ automation, profiles: [blocked] }, now), now + 15 * 60_000)
  assert.equal(routineDueAt({ automation, profiles: [ready], progress: [{ profileId: 'ready', paused: true }] }, now), now + 15 * 60_000)
  assert.equal(routineDueAt({ automation, profiles: [ready], warmups: [{ profileId: 'ready', date: '2026-09-30', todayMinutes: 10, minutesUsedToday: 10 }] }, now), Date.parse('2026-10-01T00:00:00Z'))
  assert.equal(routineDueAt({ automation, profiles: [{ ...ready, igAccountStatus: 'assigned', browserLoggedInAt: now - 24 * 60 * 60_000 }] }, now), now)
})
