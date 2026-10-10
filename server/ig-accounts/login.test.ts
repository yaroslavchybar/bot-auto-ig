import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

for (const scenario of [
  'pending',
  'active',
  'late',
  'duplicate',
  'success',
  'rejected',
  'cleanup failure',
  'startup cleanup failure',
  'launch timeout',
  'launch timeout cleanup failure',
]) {
  test(`browser login ownership: ${scenario}`, () => {
    execFileSync(
      'bun',
      [
        '--eval',
        `
      import { mock } from 'bun:test'
      import assert from 'node:assert/strict'
      const scenario = ${JSON.stringify(scenario)}
      let opened = 0
      let mutations = 0
      let closeStarted = false
      let cleanupDone = false
      let started
      const entered = new Promise(resolve => { started = resolve })
      let finishClose
      const closing = new Promise(resolve => { finishClose = resolve })
      class BrowserLaunchTimeout extends Error {
        constructor(cleanup) { super('Browser launch timed out'); this.cleanup = cleanup }
      }
      mock.module('./server/browser/cloak.ts', () => ({ BrowserLaunchTimeout, openBrowserSession: async (_name, options) => {
        opened++
        started()
        if (scenario.startsWith('launch timeout')) throw new BrowserLaunchTimeout(closing.then(() => {
          if (scenario.endsWith('cleanup failure')) throw new Error('Browser close failed')
          cleanupDone = true
        }))
        if (scenario === 'startup cleanup failure') throw new AggregateError([], 'Startup cleanup failed')
        const signal = options.signal
        if (scenario === 'pending') {
          await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
          throw new Error('Cancelled work must never launch')
        }
        const field = { waitFor: async () => {}, fill: async () => { mutations++ }, press: async () => { mutations++ } }
        const page = {
          goto: async () => {
            if (['active','duplicate'].includes(scenario))
              await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
          },
          locator: selector => selector === 'body' ? { innerText: async () => 'incorrect password' } : field,
          context: () => ({ cookies: async () => scenario === 'rejected' ? [] : [{ name: 'sessionid', value: 'session' }] }),
        }
        return { page, close: async () => {
          closeStarted = true
          if (scenario === 'cleanup failure') throw new Error('Browser close failed')
          if (['active','duplicate'].includes(scenario)) await closing
          cleanupDone = true
        } }
      } }))
      const { runBrowserLogin, cancelBrowserLogin } = await import('./server/ig-accounts/login.ts')
      const id = crypto.randomUUID()
      const args = [id, 'example', 'http://proxy.test', { username: 'example', password: 'secret', authenticatorKey: 'JBSWY3DPEHPK3PXP' }]
      if (scenario === 'late') {
        await cancelBrowserLogin(id)
        await assert.rejects(runBrowserLogin(...args), /already ended/)
        assert.equal(opened, 0)
      } else {
        const result = runBrowserLogin(...args).then(value => ({ value }), error => ({ error }))
        await entered
        if (scenario.startsWith('launch timeout')) {
          assert.match((await result).error.message, /Browser launch timed out/)
          let acknowledged = false
          const cancellation = cancelBrowserLogin(id).then(() => { acknowledged = true }, error => { acknowledged = true; throw error })
          await new Promise(resolve => setTimeout(resolve, 10))
          assert.equal(acknowledged, false, 'timeout cancellation waits for late launch cleanup')
          await assert.rejects(runBrowserLogin(...args), /already ended or started/)
          finishClose()
          if (scenario.endsWith('cleanup failure')) {
            await assert.rejects(cancellation, /cleanup failed/)
            await assert.rejects(cancelBrowserLogin(id), /cleanup failed/)
          } else {
            await cancellation
            assert.equal(cleanupDone, true)
          }
        } else if (['pending','active','duplicate'].includes(scenario)) {
          if (scenario === 'duplicate') await assert.rejects(runBrowserLogin(...args), /already ended or started/)
          let acknowledged = false
          const cancellation = cancelBrowserLogin(id).then(() => { acknowledged = true })
          if (scenario !== 'pending') {
            await new Promise(resolve => setTimeout(resolve, 10))
            assert.equal(closeStarted, true)
            assert.equal(acknowledged, false, 'cleanup must finish before cancellation acknowledgement')
            finishClose()
          }
          await cancellation
          assert.match((await result).error.message, /cancelled/)
          assert.equal(mutations, 0)
          if (scenario !== 'pending') assert.equal(cleanupDone, true)
        } else if (scenario.includes('cleanup failure')) {
          assert.ok((await result).error)
          await assert.rejects(cancelBrowserLogin(id), /cleanup failed/)
        } else {
          assert.deepEqual((await result).value, scenario === 'success' ? { ok: true } : { rejected: true })
          assert.equal(cleanupDone, true)
          await cancelBrowserLogin(id)
        }
        await assert.rejects(runBrowserLogin(...args), /already ended/)
        assert.equal(opened, 1)
      }
    `,
      ],
      { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 15_000 },
    )
  })
}
