import assert from 'node:assert/strict'
import test from 'node:test'

import { parseLogLine } from './parser.js'

test('parseLogLine handles prefixed event lines that contain the legacy sentinel text', () => {
    const parsed = parseLogLine('__EVENT__{"type":"task_progress","ts":"2026-03-13T12:00:00+00:00","detail":"checkpoint }__EVENT__ reached","profile":"alice"}')

    assert.ok(parsed)
    assert.equal(parsed.eventType, 'task_progress')
    assert.equal(parsed.metadata?.detail, 'checkpoint }__EVENT__ reached')
    assert.equal(parsed.message, '↻ Task progress: alice')
})

test('parseLogLine still accepts legacy wrapped event lines', () => {
    const parsed = parseLogLine('__EVENT__{"type":"profile_started","ts":"2026-03-13T12:00:00+00:00","profile":"alice"}__EVENT__')

    assert.ok(parsed)
    assert.equal(parsed.eventType, 'profile_started')
    assert.equal(parsed.metadata?.profile, 'alice')
    assert.equal(parsed.message, '👤 Profile started: alice')
})
