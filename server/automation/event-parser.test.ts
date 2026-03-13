import assert from 'node:assert/strict'
import test from 'node:test'

import { extractAutomationEvent } from './event-parser.js'

test('extractAutomationEvent accepts direct websocket event payloads', () => {
    const event = extractAutomationEvent({
        type: 'profile_started',
        message: '👤 Profile started: alice',
        level: 'info',
        source: 'python',
        ts: '2026-03-13T12:00:00+00:00',
        profile: 'alice',
    })

    assert.deepEqual(event, {
        type: 'profile_started',
        ts: '2026-03-13T12:00:00+00:00',
        profile: 'alice',
    })
})

test('extractAutomationEvent accepts prefix-only embedded log events', () => {
    const event = extractAutomationEvent({
        type: 'log',
        message: '__EVENT__{"type":"task_progress","ts":"2026-03-13T12:00:00+00:00","profile":"alice","task":"follow"}',
        source: 'python',
    })

    assert.deepEqual(event, {
        type: 'task_progress',
        ts: '2026-03-13T12:00:00+00:00',
        profile: 'alice',
        task: 'follow',
    })
})

test('extractAutomationEvent ignores non-event control messages', () => {
    const event = extractAutomationEvent({
        type: 'status',
        status: 'running',
    })

    assert.equal(event, null)
})
