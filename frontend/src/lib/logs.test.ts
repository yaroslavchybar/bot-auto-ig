import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeLogs, type LogEntry } from './logs'
const entry = (n: number): LogEntry => ({ id: String(n), ts: n, message: 'same message', level: 'info', source: 'test' })
test('live logs continue after capacity and repeated text remains distinct', () => {
  let logs: LogEntry[] = []
  for (let n = 0; n < 2000; n++) logs = mergeLogs(logs, [entry(n)], 1000)
  assert.equal(logs.length, 1000)
  assert.equal(logs[0].id, '1000')
  assert.equal(logs.at(-1)?.id, '1999')
})
test('late history overlaps live events without duplicates or losing newer logs', () => {
  const logs = mergeLogs([entry(3), entry(4)], [entry(1), entry(2), entry(3)], 3)
  assert.deepEqual(logs.map(log => log.id), ['2', '3', '4'])
})
test('id-less logs with different task context do not overwrite each other', () => {
  const base = { ts: 1, message: 'same message', level: 'info', source: 'test' } as const
  const logs = mergeLogs(
    [{ ...base, taskId: 'a', targetUsername: 'alice' }],
    [{ ...base, taskId: 'b', targetUsername: 'bob' }],
    10,
  )
  assert.equal(logs.length, 2)
})
