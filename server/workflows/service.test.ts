import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from '../shared/ProcessService.js'
import { runWorkflow, wireProcessLifecycle, workflowWorkers } from './service.js'

const tick = () => new Promise(resolve => setImmediate(resolve))

test('worker payload uses the newly started workflow rather than the old completed snapshot', async () => {
  const originalFetch = globalThis.fetch
  let payload = ''
  const proc = Object.assign(new EventEmitter(), {
    stdin: { write: (value: string) => { payload = value }, end: () => {} },
  }) as unknown as ChildProcess
  globalThis.fetch = (async url => {
    if (String(url).includes('/by-id')) return Response.json({ name: 'Old', nodeStates: { __profileRuns: { profile: { completed: true } } } })
    return Response.json({ name: 'Fresh', nodes: [], edges: [], status: 'pending' })
  }) as typeof fetch
  try {
    await runWorkflow({ workflowId: 'test' }, () => proc)
    assert.deepEqual(JSON.parse(payload).workflow.nodeStates, {})
    assert.equal(JSON.parse(payload).workflow.name, 'Fresh')
    proc.emit('close', 0)
    await tick()
  } finally { globalThis.fetch = originalFetch; workflowWorkers.delete('test') }
})

test('workflow remains owned until the terminal update finishes; late old events cannot alter a replacement', async () => {
  const originalFetch = globalThis.fetch
  const proc = new EventEmitter() as ChildProcess
  let finish!: () => void
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    await new Promise<void>(resolve => { finish = resolve })
    return Response.json({})
  }) as typeof fetch
  workflowWorkers.set('test', { process: proc, status: 'running', startedAt: 0 })
  try {
    wireProcessLifecycle(proc, 'test')
    proc.emit('close', 0)
    await tick()
    assert.equal(workflowWorkers.get('test')?.process, proc)
    finish()
    await tick()
    assert.equal(workflowWorkers.has('test'), false)
    const replacement = new EventEmitter() as ChildProcess
    workflowWorkers.set('test', { process: replacement, status: 'running', startedAt: 1 })
    proc.emit('close', 0)
    await tick()
    assert.equal(calls, 1)
    assert.equal(workflowWorkers.get('test')?.process, replacement)
  } finally { globalThis.fetch = originalFetch; workflowWorkers.delete('test') }
})
