import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSessionDecision } from './sessionDecision.js'

test('public decisions reject invalid scores, categories, and usernames', () => {
  const result = { kind: 'interest', status: 'complete', confidence: 0.87, related: true }
  assert.equal(isSessionDecision(result), true)
  for (const confidence of [NaN, Infinity, -0.1, 1.1, '0.8', null])
    assert.equal(isSessionDecision({ ...result, confidence }), false)
  const profile = { kind: 'profile', status: 'complete', username: 'lead.name', category: 'male', confidence: 0.9 }
  assert.equal(isSessionDecision(profile), true)
  assert.equal(isSessionDecision({ ...profile, category: 'unknown' }), false)
  assert.equal(isSessionDecision({ ...profile, username: 'not a username' }), false)
  assert.equal(isSessionDecision({ ...result, related: 'yes' }), false)
})
