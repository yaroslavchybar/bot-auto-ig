import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

for (const scenario of ['expired waits', 'positive wait', 'shutdown', 'deadline race'])
  test(`browser sleep handles ${scenario} without invalid timers`, () => {
    const result = spawnSync(process.execPath, ['--trace-warnings', '--eval', `
      import assert from 'node:assert/strict'
      import { getEventListeners } from 'node:events'
      import { sleep, requestStop, shutdownSignal } from './server/browser/lifecycle.ts'
      import { BrowseSession, SessionEnded } from './server/automation/actions/session.ts'
      const scenario = ${JSON.stringify(scenario)}
      const originalTimer = globalThis.setTimeout
      const originalNow = Date.now
      const delays = []
      globalThis.setTimeout = (fn, ms, ...args) => {
        assert.ok(ms > 0, 'must not schedule an expired timer: ' + ms)
        delays.push(ms)
        return originalTimer(fn, ms, ...args)
      }
      try {
        if (scenario === 'expired waits') {
          await sleep(-0.99755859375)
          await sleep(-1000)
          await sleep(0)
          assert.deepEqual(delays, [])
        } else if (scenario === 'positive wait') {
          await sleep(2.5)
          assert.deepEqual(delays, [2.5])
        } else if (scenario === 'shutdown') {
          const pending = sleep(60_000)
          requestStop()
          await assert.rejects(pending, error => error === shutdownSignal.reason)
          for (const ms of [-1, 0, 1000])
            assert.throws(() => sleep(ms), error => error === shutdownSignal.reason)
          assert.deepEqual(delays, [60_000])
        } else {
          // The clock crosses a fractional session deadline during one loop iteration.
          const reads = [1000, 1000, 1200, 1200, 1201]
          Date.now = () => reads.shift() ?? 1201
          await assert.rejects(new BrowseSession(1200.00244140625).wait(1000), SessionEnded)
        }
        assert.equal(getEventListeners(shutdownSignal, 'abort').length, 0)
      } finally {
        globalThis.setTimeout = originalTimer
        Date.now = originalNow
      }
    `], { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, 0, result.stderr)
    assert.doesNotMatch(result.stderr, /TimeoutNegativeWarning|TimeoutOverflowWarning/)
  })
