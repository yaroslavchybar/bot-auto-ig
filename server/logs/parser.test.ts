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

test('parseLogLine handles structured events after stream and timestamp prefixes', () => {
    const parsed = parseLogLine('- [pid=12345][out] [2026-03-13T12:00:00+00:00] __EVENT__{"type":"profile_started","profile":"alice"}')

    assert.ok(parsed)
    assert.equal(parsed.eventType, 'profile_started')
    assert.equal(parsed.metadata?.profile, 'alice')
    assert.equal(parsed.message, '👤 Profile started: alice')
})

test('parseLogLine treats array event payloads as plain log lines', () => {
    const parsed = parseLogLine('__EVENT__["profile_started",{"profile":"alice"}]')

    assert.ok(parsed)
    assert.equal(parsed.eventType, undefined)
    assert.equal(parsed.metadata, undefined)
    assert.equal(parsed.message, '__EVENT__["profile_started",{"profile":"alice"}]')
})

test('parseLogLine treats primitive event payloads as plain log lines', () => {
    const parsed = parseLogLine('__EVENT__true')

    assert.ok(parsed)
    assert.equal(parsed.eventType, undefined)
    assert.equal(parsed.metadata, undefined)
    assert.equal(parsed.message, '__EVENT__true')
})
