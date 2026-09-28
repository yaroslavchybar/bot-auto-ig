import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

const cwd = new URL('../../', import.meta.url)

test('concurrent manual starts spawn once and keep ownership during delayed cleanup', () => {
  execFileSync('bun', ['--eval', `
    import assert from 'node:assert/strict'
    import { EventEmitter } from 'node:events'
    const { startProfileBrowser } = await import('./server/profiles/service.ts')
    const { profileProcesses } = await import('./server/shared/store.ts')
    const tick = () => new Promise(resolve => setImmediate(resolve))
    const proc = new EventEmitter()
    let launches = 0
    let finish
    let idleStarted
    const idleRequested = new Promise(resolve => { idleStarted = resolve })
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('/api/profiles')) return Response.json([{ name: 'test', id: 'test' }])
      if (JSON.parse(String(init?.body)).status === 'idle') {
        idleStarted()
        await new Promise(resolve => { finish = resolve })
      }
      return Response.json({})
    }
    const spawn = () => { launches++; return proc }
    try {
      const results = await Promise.allSettled([startProfileBrowser('test', spawn), startProfileBrowser('test', spawn)])
      assert.equal(launches, 1)
      assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected'])
      proc.emit('close', 0)
      await idleRequested
      await assert.rejects(startProfileBrowser('test', spawn), /already running/)
      assert.equal(profileProcesses.get('test'), proc)
      finish()
      await tick()
      assert.equal(profileProcesses.has('test'), false)
    } finally {
      finish?.()
      globalThis.fetch = originalFetch
      profileProcesses.delete('test')
    }
  `], { cwd, timeout: 15_000 })
})

test('reconciliation never clears a live automation profile, even before its first event', () => {
  execFileSync('bun', ['--eval', `
    import assert from 'node:assert/strict'
    import { EventEmitter } from 'node:events'
    const { profileManager } = await import('./server/profiles/data.ts')
    const { profileProcesses } = await import('./server/shared/store.ts')
    let calls = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => { calls++; throw new Error('Must not access database') }
    profileProcesses.set('busy', new EventEmitter())
    try {
      assert.deepEqual(await profileManager.reconcileRuntimeStatuses([]), { cleared: 0, errors: [] })
      assert.equal(calls, 0)
    } finally {
      globalThis.fetch = originalFetch
      profileProcesses.delete('busy')
    }
  `], { cwd, timeout: 15_000 })
})
