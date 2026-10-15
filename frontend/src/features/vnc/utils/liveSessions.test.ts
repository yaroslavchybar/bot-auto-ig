import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyDisplayEvent, mergeSessionSnapshot, normalizeSessions } from './liveSessions'

const display = { id: 'lease-1', automationId: 'automation', profileName: 'profile', vncPort: 6081, displayNum: 100, status: 'active' }
const result = { kind: 'interest', status: 'complete', confidence: 0.87, related: true }
const event = { type: 'session_decision', displayId: 'lease-1', automationId: 'automation', profileName: 'profile', decision: result }

test('only valid decisions for the exact browser lease reach the session', () => {
  const sessions = normalizeSessions([display])
  for (const fields of [{ displayId: 'old-lease' }, { automationId: 'another' }, { profileName: 'another' },
    { decision: { ...result, confidence: NaN } }, { decision: undefined }])
    assert.equal(applyDisplayEvent(sessions, { ...event, ...fields })[0]?.decision, undefined)
  const updated = applyDisplayEvent(sessions, event)
  assert.deepEqual(updated[0]?.decision, result)
  assert.equal(applyDisplayEvent(updated, { ...event, decision: null })[0]?.decision, null)
})

test('polling preserves current decisions but never carries them into a replacement lease', () => {
  const updated = applyDisplayEvent(normalizeSessions([display]), event)
  assert.deepEqual(mergeSessionSnapshot(updated, [display])[0]?.decision, result)
  assert.equal(mergeSessionSnapshot(updated, [{ ...display, id: 'lease-2' }])[0]?.decision, undefined)
  assert.equal(applyDisplayEvent(updated, { type: 'display_released', automationId: 'automation', profileName: 'profile' }).length, 0)
  const allocated = applyDisplayEvent([], { ...display, type: 'display_allocated' })
  assert.deepEqual(applyDisplayEvent(allocated, event)[0]?.decision, result)
})
