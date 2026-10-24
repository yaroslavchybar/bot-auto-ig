import assert from 'node:assert/strict'
import test from 'node:test'
import { parseLogLine } from './parser.js'

const entry = { id: 'entry-1', ts: 1, event: 'browser.session', message: 'browser session',
  level: 'info', source: 'manual-worker', requestId: 'request-123', outcome: 'success',
  environment: { service: 'manual-worker' }, context: { profileCount: 1 } }

test('only canonical log entries are parsed; other output stays with the console handler', () => {
  for (const raw of [
    '', ' ', 'finished without error', '{bad json}', 'null', '[]',
    '{"level":"debug","message":"external"}',
    '__EVENT__true__EVENT__',
    '__EVENT__{"type":"task_progress","detail":"checkpoint }__EVENT__ reached"}__EVENT__',
  ]) assert.equal(parseLogLine(raw), null)
  assert.deepEqual(parseLogLine(`  ${JSON.stringify(entry)}\n`), entry)
})
