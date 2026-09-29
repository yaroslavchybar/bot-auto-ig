import assert from 'node:assert/strict'
import test from 'node:test'
import { createLogStreamParser, parseLogLine } from './parser.js'

const entry = { id: 'entry-1', ts: 1, event: 'browser.session', message: 'browser session',
  level: 'info', source: 'manual-worker', requestId: 'request-123', outcome: 'success',
  environment: { service: 'manual-worker' }, context: { profileCount: 1 } }

test('worker events and JSON logs survive arbitrary byte boundaries and UTF-8 splits', () => {
  const parser = createLogStreamParser()
  const data = Buffer.from('__EVENT__{"type":"task_progress","profileName":"Ярослав"}__EVENT__\n' + JSON.stringify(entry) + '\nfinished')
  const parsed = [...data].flatMap(byte => parser.write(Buffer.from([byte])))
  parsed.push(...parser.end())
  assert.equal(parsed.length, 3)
  assert.equal(parsed[0].metadata?.profileName, 'Ярослав')
  assert.deepEqual(parsed[1].logEntry, entry)
  assert.equal(parsed[2].message, 'finished')
})

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

test('oversized output is bounded and the next valid line still parses', () => {
  const parser = createLogStreamParser()
  const results = parser.write(Buffer.from('x'.repeat(300000)))
  assert.equal(results[0].level, 'error')
  assert.equal(parser.write(Buffer.from('discard\n' + JSON.stringify(entry) + '\n'))[0].logEntry?.id, entry.id)
  assert.deepEqual(parser.end(), [])
})

test('JSON objects without the canonical schema remain external output', () => {
  assert.equal(parseLogLine('{"level":"debug","message":"external"}')?.logEntry, undefined)
  assert.equal(parseLogLine('finished without error')?.level, 'info')
})
