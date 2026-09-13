import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPool } from './pool.js'

test('pool refills a finished slot before the slowest job finishes', async () => {
  let unblock!: () => void
  const slow = new Promise<void>(resolve => { unblock = resolve })
  const started: number[] = []
  await runPool([0, 1, 2], 2, async item => {
    started.push(item)
    if (item === 0) await slow
    if (item === 2) { assert.deepEqual(started, [0, 1, 2]); unblock() }
  })
})

test('pool drains active jobs but admits no new jobs after failure', async () => {
  const started: number[] = []
  let drained = false
  await assert.rejects(runPool([0, 1, 2], 2, async item => {
    started.push(item)
    if (!item) throw new Error('failed')
    await new Promise(resolve => setImmediate(resolve))
    drained = true
  }), /failed/)
  assert.deepEqual(started, [0, 1])
  assert.equal(drained, true)
})
