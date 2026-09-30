import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

test('scraper bridge coalesces updates and sends idle after pending work on stop', () => {
  execFileSync(
    'bun',
    [
      '--eval',
      `
    import assert from 'node:assert/strict'
    import { mock } from 'bun:test'
    let update, unsubscribed = false
    const calls = [], gates = []
    mock.module('./server/shared/convexRealtime.ts', () => ({ watchScraperWork: callback => { update = callback; return { initial: Promise.resolve(), unsubscribe() { unsubscribed = true } } } }))
    mock.module('./server/shared/runtime.ts', () => ({ runtimeRequest: async (route, options) => {
      assert.equal(route, '/scraper/work'); calls.push(JSON.parse(options.body))
      if (calls.length < 3) await new Promise(resolve => gates.push(resolve))
      return { ok: true }
    } }))
    mock.module('./server/shared/logger.ts', () => ({ default: { error() {} } }))
    const { startScraperWorker } = await import('./server/scraper/worker.ts')
    const stop = startScraperWorker()
    const state = jobKey => ({ jobAt: 0, jobKey, enrichmentKey: null })
    update(state('first')); update(state('second')); update(state('latest'))
    assert.deepEqual(calls, [state('first')])
    gates.shift()(); await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(calls, [state('first'), state('latest')])
    stop(); assert.equal(unsubscribed, true); assert.equal(calls.length, 2)
    gates.shift()(); await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(calls.at(-1), { jobAt: null, jobKey: null, enrichmentKey: null })
    update(state('after-stop')); assert.equal(calls.length, 3)
  `,
    ],
    { cwd: process.cwd(), stdio: 'pipe', timeout: 30_000 },
  )
})
