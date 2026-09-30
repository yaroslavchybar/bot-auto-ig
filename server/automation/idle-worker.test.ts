import { execFileSync } from 'node:child_process'
import test from 'node:test'

test('a resting routine yields its deadline and closes its realtime subscription', () => {
  execFileSync('bun', ['--eval', `
    import assert from 'node:assert/strict'
    import { mock } from 'bun:test'
    let closed = 0
    const dueAt = Date.now() + 60_000
    const snapshot = { automation: { isActive: true, status: 'running' },
      profiles: [{ id: 'resting', name: 'Resting', listIds: ['list'], igLoggedIn: true, using: false }],
      progress: [{ profileId: 'resting', nextRunAt: dueAt }] }
    const realtime = await import('./server/shared/convexRealtime.ts')
    mock.module('./server/shared/convexRealtime.ts', () => ({
      ...realtime,
      watchRoutineRuntime: (_id, _lists, update) => { update(snapshot); return { initial: Promise.resolve(snapshot), unsubscribe: () => closed++ } },
      watchRoutineAccess: () => { throw new Error('Must not start a resting profile') },
      closeConvexRealtime: async () => {},
    }))
    const events = []
    const write = process.stdout.write
    process.stdout.write = (line, callback) => {
      if (String(line).startsWith('__EVENT__')) events.push(JSON.parse(String(line).trim().slice(9, -9)))
      callback?.(); return true
    }
    try {
      const { runAutomation } = await import('./server/automation/worker.ts')
      await runAutomation({ automationId: 'routine', yieldWhenIdle: true,
        automation: { _id: 'routine', nodes: [], edges: [], listIds: ['list'], routine: { headless: true } } })
      assert.equal(closed, 1)
      assert.equal(events.at(-1).type, 'worker_waiting')
      assert.equal(events.at(-1).dueAt, dueAt)
      assert.ok(!events.some(event => event.type === 'profile_started'))
    } finally { process.stdout.write = write }
  `], { cwd: process.cwd(), stdio: 'pipe', timeout: 10_000 })
})
