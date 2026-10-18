import assert from 'node:assert/strict'
import test from 'node:test'
import { parseLogLine } from './parser.js'

const entry = { id: 'entry-1', ts: 1, event: 'browser.session', message: 'browser session',
  level: 'info', source: 'manual-worker', requestId: 'request-123', outcome: 'success',
  environment: { service: 'manual-worker' }, context: { profileCount: 1 } }

test('malformed control messages remain diagnostic text, not UI events', () => {
  for (const raw of ['__EVENT__true__EVENT__', '__EVENT__["profile_started"]__EVENT__', '__EVENT__{"type":2}__EVENT__']) {
    const parsed = parseLogLine(raw)
    assert.equal(parsed?.eventType, undefined)
    assert.equal(parsed?.message, raw)
  }
})

test('control messages can contain the sentinel inside their JSON fields', () => {
  const parsed = parseLogLine('__EVENT__{"type":"task_progress","detail":"checkpoint }__EVENT__ reached"}__EVENT__')
  assert.equal(parsed?.metadata?.detail, 'checkpoint }__EVENT__ reached')
})

test('JSON objects without the canonical schema remain external output', () => {
  assert.equal(parseLogLine('{"level":"debug","message":"external"}')?.logEntry, undefined)
  assert.equal(parseLogLine('finished without error')?.level, 'info')
  assert.deepEqual(parseLogLine(JSON.stringify(entry))?.logEntry, entry)
})
