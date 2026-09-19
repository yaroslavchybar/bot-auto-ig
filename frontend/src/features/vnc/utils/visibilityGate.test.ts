import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createVisibilityGate } from './visibilityGate'

test('brief hiding keeps the connection, prolonged hiding closes it, cleanup cancels timers', async () => {
  const values: boolean[] = []
  const gate = createVisibilityGate((active) => values.push(active), 20)
  gate.update(true)
  gate.update(false)
  gate.update(true)
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.deepEqual(values, [true])
  gate.update(false)
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.deepEqual(values, [true, false])
  gate.update(true)
  gate.update(false)
  gate.dispose()
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.deepEqual(values, [true, false, true])
})
