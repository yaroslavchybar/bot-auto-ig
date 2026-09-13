import { test } from 'node:test'
import assert from 'node:assert/strict'
import { latestQueue } from './latest-queue.js'

test('slow writes keep only the latest pending snapshot and drain before resolving', async () => {
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  const written: number[] = []
  const queue = latestQueue<number>(async value => {
    written.push(value)
    if (value === 0) await blocked
  })
  let drained = queue.push(0)
  await Promise.resolve()
  for (let value = 1; value <= 1000; value++) drained = queue.push(value)
  release()
  await drained
  assert.deepEqual(written, [0, 1000])
  await queue.push(1001)
  assert.deepEqual(written, [0, 1000, 1001])
})
