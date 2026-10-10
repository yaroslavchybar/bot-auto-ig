import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'

for (const [cleanupFails, launchTimesOut] of [
  [false, false], [false, true], [true, false], [true, true],
]) {
  test(`shutdown drains browser logins before exit (cleanup failure: ${cleanupFails}, launch timeout: ${launchTimesOut})`, () => {
    const result = spawnSync('bun', ['--eval', `
      import { mock } from 'bun:test'
      import assert from 'node:assert/strict'
      let opened = 0, closed = 0, runtimeStopped = false, runtimeShutdown = false
      let finishClose, closeStarted
      const closing = new Promise(resolve => { finishClose = resolve })
      const entered = new Promise(resolve => { closeStarted = resolve })
      class BrowserLaunchTimeout extends Error {
        constructor(cleanup) { super('Browser launch timed out'); this.cleanup = cleanup }
      }
      mock.module('./server/browser/cloak.ts', () => ({ BrowserLaunchTimeout, openBrowserSession: async (_name, {signal}) => {
        const index = opened++
        const close = async () => {
          closeStarted()
          await closing
          closed++
          if (${cleanupFails} && index === 0) throw Error('Fixture cleanup failed')
        }
        if (${launchTimesOut}) throw new BrowserLaunchTimeout(close())
        return {
          page: { goto: async () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once:true})) },
          close,
        }
      } }))
      mock.module('./server/shared/convexRealtime.ts', () => ({ closeConvexRealtime: async () => {} }))
      mock.module('./server/shared/runtime.ts', () => ({
        runtimeRequest: async () => { assert.equal(closed, 2); runtimeShutdown = true },
        stopRuntime: async () => { assert.equal(closed, 2); runtimeStopped = true },
      }))
      mock.module('./server/shared/logger.ts', () => ({ logOperation: async (_event, _fields, fn) => fn() }))
      const { runBrowserLogin } = await import('./server/ig-accounts/login.ts')
      const { registerShutdownHandlers } = await import('./server/automation/shutdown.ts')
      const credentials = {username:'fixture',password:'fixture',authenticatorKey:''}
      void runBrowserLogin('one', 'fixture', '', credentials).catch(() => {})
      void runBrowserLogin('two', 'fixture', '', credentials).catch(() => {})
      await Bun.sleep(10)
      const originalExit = process.exit
      process.exit = code => {
        assert.equal(closed, 2)
        assert.equal(runtimeStopped, true)
        assert.equal(runtimeShutdown, !${cleanupFails})
        console.log('cleanup-finished-before-exit')
        originalExit(code)
      }
      registerShutdownHandlers({httpServer:{close() {}}})
      process.emit('SIGTERM')
      await entered
      await assert.rejects(runBrowserLogin('late', 'fixture', '', credentials), /stopping/)
      await Bun.sleep(10)
      assert.equal(runtimeStopped, false)
      finishClose()
    `], { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 15_000 })
    assert.equal(result.status, cleanupFails ? 1 : 0, result.stderr)
    assert.match(result.stdout, /cleanup-finished-before-exit/)
  })
}
