import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { startProfileBrowser } from './service.js'
import { profileManager } from './data.js'
import { profileProcesses } from '../shared/store.js'
import type { ChildProcess, spawnBun } from '../shared/ProcessService.js'

const tick = () => new Promise(resolve => setImmediate(resolve))

test('concurrent manual starts spawn once and keep ownership during delayed cleanup', async () => {
  const originalFetch = globalThis.fetch
  const proc = new EventEmitter() as ChildProcess
  let launches = 0
  let finish!: () => void
  globalThis.fetch = (async (url, init) => {
    if (String(url).endsWith('/api/profiles')) return Response.json([{ name: 'test', id: 'test' }])
    if (JSON.parse(String(init?.body)).status === 'idle') await new Promise<void>(resolve => { finish = resolve })
    return Response.json({})
  }) as typeof fetch
  const spawn = (() => { launches++; return proc }) as typeof spawnBun
  try {
    const results = await Promise.allSettled([startProfileBrowser('test', spawn), startProfileBrowser('test', spawn)])
    assert.equal(launches, 1)
    assert.deepEqual(results.map(r => r.status), ['fulfilled', 'rejected'])
    proc.emit('close', 0)
    await tick()
    await assert.rejects(startProfileBrowser('test', spawn), /already running/)
    assert.equal(profileProcesses.get('test'), proc)
    finish()
    await tick()
    assert.equal(profileProcesses.has('test'), false)
  } finally { globalThis.fetch = originalFetch; profileProcesses.delete('test') }
})

test('reconciliation never clears a live automation profile, even before its first event', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => { calls++; throw new Error('Must not access database') }) as typeof fetch
  profileProcesses.set('busy', new EventEmitter() as ChildProcess)
  try {
    assert.deepEqual(await profileManager.reconcileRuntimeStatuses([]), { cleared: 0, errors: [] })
    assert.equal(calls, 0)
  } finally { globalThis.fetch = originalFetch; profileProcesses.delete('busy') }
})
