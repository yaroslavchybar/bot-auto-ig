import test from 'node:test'
import assert from 'node:assert/strict'
import type { BrowserSession } from '../browser/cloak.js'
import { runAutomation, type WorkerDependencies } from './worker.js'
import type { RuntimeSnapshot } from '../shared/convexRealtime.js'

function fixture() {
  const profile = (id: string, extra = {}) => ({ id, name: id, modelId: 'model', inUse: false, ...extra })
  const snapshot: NonNullable<RuntimeSnapshot> = {
    automation: { status: 'running', isActive: true }, profiles: [profile('first'), profile('second')],
  }
  const opened: string[] = [], closed: string[] = [], issues: string[] = []
  let unsubscribed = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (url, init) => {
    if (String(url).endsWith('/api/routines/session')) {
      const body = JSON.parse(String(init?.body))
      issues.push(body.profileId)
    }
    return Response.json(true)
  }) as typeof fetch
  const deps: Partial<WorkerDependencies> = {
    watchRuntime: (_id, _models, update) => {
      update(snapshot)
      return { initial: Promise.resolve(snapshot), unsubscribe() { unsubscribed++ } }
    },
    watchRoutineAccess: (_id, _profile, update) => {
      update(true)
      return { initial: Promise.resolve(true), unsubscribe() { unsubscribed++ } }
    },
    openSession: async name => {
      opened.push(name)
      return { page: {}, close: async () => { closed.push(name) } } as unknown as BrowserSession
    },
    runSession: async () => false,
    setupModel: async () => false,
    postModelUpdate: async () => false,
  }
  return {
    profile, snapshot, opened, closed, issues, deps,
    run: (overrides: Partial<WorkerDependencies> = {}) => runAutomation({
      automationId: 'automation', yieldWhenIdle: true,
      automation: { modelIds: ['model'], routine: { activity: {}, headless: true } },
    }, { ...deps, ...overrides }),
    restore: () => { globalThis.fetch = originalFetch },
    subscriptions: () => unsubscribed,
  }
}

test('routine queue excludes paused, busy, unrelated, resting and exhausted profiles', async () => {
  const s = fixture()
  s.snapshot.profiles.push(s.profile('paused', { paused: true }), s.profile('busy', { inUse: true }),
    s.profile('other', { modelId: 'other' }), s.profile('resting'), s.profile('exhausted'), s.profile('issue'))
  s.snapshot.progress = [{ profileId: 'resting', nextRunAt: Date.now() + 60_000 }, { profileId: 'issue', issue: 'Check delivery' }]
  s.snapshot.warmups = [{ profileId: 'exhausted', date: new Date().toISOString().slice(0, 10), todayMinutes: 10, minutesUsedToday: 10 }]
  try {
    await s.run()
    assert.deepEqual(s.opened, ['first', 'second'])
    assert.deepEqual(s.closed, s.opened)
    assert.equal(s.subscriptions(), 3)
  } finally { s.restore() }
})

test('one failed browser startup records its issue and still runs the next profile', async () => {
  const s = fixture()
  try {
    await s.run({ openSession: async (name, options) => {
      if (name === 'first') throw new Error('Profile is already open')
      return s.deps.openSession!(name, options)
    } })
    assert.deepEqual(s.opened, ['second'])
    assert.deepEqual(s.issues, ['first'])
    assert.equal(s.subscriptions(), 3)
  } finally { s.restore() }
})

test('action and cleanup failures close each session once and do not stop later profiles', async () => {
  const s = fixture()
  try {
    await s.run({ runSession: async () => { throw new Error('Action failed') }, openSession: async (name, options) => {
      const session = await s.deps.openSession!(name, options)
      return { ...session, close: async () => { await session.close(); throw new Error('Cleanup failed') } }
    } })
    assert.deepEqual(s.closed, ['first', 'second'])
    assert.deepEqual(s.issues, ['first', 'second'])
  } finally { s.restore() }
})

test('revoked routine access prevents opening a browser', async () => {
  const s = fixture()
  try {
    await s.run({ watchRoutineAccess: (_id, _profile, update) => {
      update(false)
      return { initial: Promise.resolve(false), unsubscribe() {} }
    } })
    assert.deepEqual(s.opened, [])
  } finally { s.restore() }
})

test('a configuration change terminates the old worker after cleanup', async () => {
  const s = fixture()
  let notify!: (snapshot: RuntimeSnapshot) => void
  try {
    await assert.rejects(s.run({
      watchRuntime: (_id, _models, update) => {
        notify = update; update(s.snapshot)
        return { initial: Promise.resolve(s.snapshot), unsubscribe() {} }
      },
      openSession: async (name, options) => {
        const session = await s.deps.openSession!(name, options)
        return { ...session, close: async () => {
          await session.close()
          notify({ ...s.snapshot, automation: { ...s.snapshot.automation, configRevision: 'changed' } })
        } }
      },
    }), /configuration changed/)
    assert.deepEqual(s.closed, s.opened)
  } finally { s.restore() }
})
