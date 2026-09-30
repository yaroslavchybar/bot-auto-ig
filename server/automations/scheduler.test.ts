import test from 'node:test'
import { execFileSync } from 'node:child_process'

test('native wakeups start only ready routines, enforce capacity and cancel disabled jobs', () => {
  execFileSync('bun', ['--eval', `
    import assert from 'node:assert/strict'
    import { mock } from 'bun:test'
    import { spawn } from 'node:child_process'
    import { createServer } from 'node:net'
    import path from 'node:path'
    const tcp = createServer()
    await new Promise(resolve => tcp.listen(0, '127.0.0.1', resolve))
    const port = tcp.address().port
    await new Promise(resolve => tcp.close(resolve))
    process.env.RUNTIME_URL = 'http://127.0.0.1:' + port
    process.env.AUTOMATION_MAX_CONCURRENCY = '1'
    const child = spawn(path.resolve('target/debug/ig-runtime' + (process.platform === 'win32' ? '.exe' : '')),
      ['helper'], { env: { ...process.env, RUNTIME_PORT: String(port) }, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
    child.stderr.on('data', () => {})
    const until = async check => {
      const deadline = Date.now() + 4000
      while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
      assert.ok(check(), 'Condition did not complete')
    }
    let stop
    try {
      let healthy = false
      for (let attempt = 0; attempt < 100 && !healthy; attempt++) {
        try { healthy = (await fetch(process.env.RUNTIME_URL + '/health')).ok } catch {}
        if (!healthy) await new Promise(resolve => setTimeout(resolve, 20))
      }
      assert.ok(healthy)
      const workers = new Map(), updates = new Map(), starts = [], stops = []
      let activeUpdate, closed, unsubscribed = 0
      const rows = ['one', 'two'].map(_id => ({ _id, hasRoutine: true, isActive: true, listIds: ['list'] }))
      const snapshot = (id, dueAt) => ({ automation: { isActive: true, status: 'pending' },
        profiles: [{ id, igLoggedIn: true, using: false }], progress: [{ profileId: id, nextRunAt: dueAt }] })
      mock.module('./server/automations/service.ts', () => ({
        automationMutex: { acquire: async () => () => {} }, automationWorkers: workers,
        runAutomation: async ({ automationId }) => { starts.push(automationId); workers.set(automationId, {}) },
        stopAutomations: async id => { stops.push(id); workers.delete(id) },
        onWorkerClosed: listener => { closed = listener; return () => {} },
      }))
      mock.module('./server/shared/convexRealtime.ts', () => ({
        watchActiveRoutines: update => { activeUpdate = update; queueMicrotask(() => update(rows)); return { initial: Promise.resolve(rows), unsubscribe: () => unsubscribed++ } },
        watchRoutineRuntime: (id, _lists, update) => {
          updates.set(id, update); const value = snapshot(id, Date.now() + 60000)
          queueMicrotask(() => update(value))
          return { initial: Promise.resolve(value), unsubscribe: () => unsubscribed++ }
        }, closeConvexRealtime: async () => {},
      }))
      const { startRoutineScheduler } = await import('./server/automations/scheduler.ts')
      stop = startRoutineScheduler()
      await until(() => updates.size === 2)
      await new Promise(resolve => setTimeout(resolve, 50))
      assert.deepEqual(starts, [])
      updates.get('one')(snapshot('one', 0))
      await until(() => starts.length === 1)
      updates.get('two')(snapshot('two', 0))
      await new Promise(resolve => setTimeout(resolve, 100))
      assert.deepEqual(starts, ['one'])
      workers.delete('one'); closed('one', Date.now() + 60000)
      await until(() => starts.length === 2)
      assert.deepEqual(starts, ['one', 'two'])
      activeUpdate([rows[0], { ...rows[1], isActive: false }])
      await until(() => stops.length === 1)
      assert.deepEqual(stops, ['two'])
      stop(); stop = undefined
      assert.equal(unsubscribed, 3)
    } finally {
      stop?.()
      const exited = new Promise(resolve => child.once('exit', resolve))
      child.stdin.end('stop\\n')
      const timer = setTimeout(() => child.kill(), 2000)
      await exited; clearTimeout(timer)
    }
  `], { cwd: process.cwd(), stdio: 'pipe', timeout: 15_000 })
})
