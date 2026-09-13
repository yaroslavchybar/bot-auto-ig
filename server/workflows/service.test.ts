import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from '../shared/ProcessService.js'
import { runWorkflow, wireProcessLifecycle, workflowWorkers } from './service.js'
import { clients } from '../shared/store.js'
import { WebSocket } from 'ws'

const tick = () => new Promise(resolve => setImmediate(resolve))

test('checkpoint bursts coalesce, stay off websocket, and survive a state-less terminal event', async () => {
  const originalFetch = globalThis.fetch
  const stdout = new EventEmitter()
  const proc = Object.assign(new EventEmitter(), { stdout, stdin: { write: () => {}, end: () => {} } }) as unknown as ChildProcess
  const writes: Array<Record<string, any>> = []
  const messages: Array<Record<string, any>> = []
  const client = { readyState: WebSocket.OPEN, bufferedAmount: 0,
    send: (message: string) => messages.push(JSON.parse(message)) } as unknown as WebSocket
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  globalThis.fetch = (async (url, options) => {
    if (String(url).endsWith('/update-status')) {
      writes.push(JSON.parse(String(options?.body)))
      if (writes.length === 1) await blocked
      return Response.json({})
    }
    return Response.json({ name: 'Test', nodes: [], edges: [] })
  }) as typeof fetch
  clients.add(client)
  const emit = (data: object) => stdout.emit('data', Buffer.from(`__EVENT__${JSON.stringify(data)}__EVENT__\n`))
  try {
    await runWorkflow({ workflowId: 'burst' }, () => proc)
    emit({ type: 'session_started' })
    await tick()
    for (let index = 0; index < 100; index++) emit({ type: 'checkpoint', nodeStates: { index }, nodeId: 'node' })
    emit({ type: 'session_ended', status: 'failed', error: 'boom' })
    release()
    await (proc as any).__statusUpdates
    assert.equal(writes.length, 2)
    assert.deepEqual(writes[1].nodeStates, { index: 99 })
    assert.equal(writes[1].status, 'failed')
    assert.equal(messages.some(message => message.type === 'checkpoint' || message.nodeStates), false)
  } finally {
    release()
    clients.delete(client)
    workflowWorkers.delete('burst')
    globalThis.fetch = originalFetch
  }
})

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
