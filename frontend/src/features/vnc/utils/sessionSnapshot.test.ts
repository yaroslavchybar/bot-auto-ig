import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSessionSnapshotGuard, isSessionEvent } from './sessionSnapshot'

test('socket events and newer polls invalidate old snapshots', () => {
  const guard = createSessionSnapshotGuard()
  const beforeEvent = guard.begin()
  guard.invalidate()
  assert.equal(guard.isCurrent(beforeEvent), false)
  const oldPoll = guard.begin()
  const newPoll = guard.begin()
  assert.equal(guard.isCurrent(oldPoll), false)
  assert.equal(guard.isCurrent(newPoll), true)
  guard.invalidate() // hidden/unmounted
  assert.equal(guard.isCurrent(newPoll), false)
})

test('log traffic does not invalidate session snapshots', () => {
  assert.equal(isSessionEvent({ type: 'log' }), false)
  assert.equal(isSessionEvent({ type: 'display_released' }), true)
  assert.equal(isSessionEvent({ type: 'display_allocated' }), true)
})
