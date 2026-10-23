import test from 'node:test'
import assert from 'node:assert/strict'
import { runAutomation, type WorkerDependencies } from './worker.js'
import type { BrowserSession } from '../browser/cloak.js'
import type { RuntimeSnapshot } from '../shared/convexRealtime.js'
import { spawnSync } from 'node:child_process'

const profile = { id: 'p', name: 'Profile', modelIds: ['model'], igLoggedIn: true, inUse: false }

for (const outcome of ['stalled', 'error field', 'error note', 'success', 'cancelled'])
  test(`parent session retains a profile outcome without failing the worker (${outcome})`, () => {
    const result = spawnSync(process.execPath, ['--eval', `
      import assert from 'node:assert/strict'
      import { runAutomation } from './server/automation/worker.ts'
      import logger, { logOperation, addLogContext, redactLogValues } from './server/shared/logger.ts'
      const outcome = ${JSON.stringify(outcome)}
      const profile = {id:'p',name:'fixture',modelIds:['m'],igLoggedIn:true,inUse:false}
      const snapshot = {automation:{status:'running',isActive:true},profiles:[profile]}
      let updateRuntime, closed = 0
      globalThis.fetch = async () => Response.json({})
      await logOperation('automation.session', {}, () => runAutomation({automation:{
        nodes:[{id:'start',type:'start',data:{config:{sourceLists:['m']}}}],edges:[]
      }}, {
        watchRuntime: (_id,_lists,update) => {
          updateRuntime = update; update(snapshot)
          return {initial:Promise.resolve(snapshot),unsubscribe() {}}
        },
        watchProfileAccess: (_id,update) => {
          update(true); return {initial:Promise.resolve(true),unsubscribe() {}}
        },
        openSession: async () => ({page:{},close:async () => {
          closed++
          redactLogValues('profile-private-secret')
          if (outcome === 'stalled') addLogContext({outcome:'error',sessionReason:'stalled'})
          else if (outcome === 'error field') addLogContext({outcome:'error',error:Error('profile-private-secret')})
          else if (outcome === 'error note') logger.error({event:'profile.idle_failed',error:Error('profile-private-secret')})
          else if (outcome === 'cancelled') addLogContext({outcome:'cancelled'})
          updateRuntime({...snapshot,automation:{status:'cancelled',isActive:false}})
        }})
      }))
      assert.equal(closed, 1)
    `], { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, 0, result.stderr)
    const logs = result.stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))
    const child = logs.find(entry => entry.event === 'automation.profile_session')
    const parent = logs.find(entry => entry.event === 'automation.session')
    const failed = ['stalled', 'error field', 'error note'].includes(outcome)
    assert.equal(child.outcome, failed ? 'error' : outcome)
    assert.equal(parent.outcome, failed ? 'error' : 'success')
    if (failed) {
      if (outcome === 'stalled') assert.equal(parent.error.message, 'Profile session failed: stalled')
      else assert.equal(parent.error.message, child.error.message)
      const note = parent.context.notes.find((note: Record<string, unknown>) => note.event === 'automation.profile_failed')
      assert.equal(note.profileId, 'p')
      assert.equal(note.childOperationId, child.operationId)
    }
    assert.ok(!JSON.stringify(logs).includes('profile-private-secret'))
  })

for (const pending of ['runtime', 'routine access', 'profile access'])
  test(`shutdown cancels initial ${pending} subscription before a browser opens`, () => {
    const result = spawnSync(process.execPath, ['--eval', `
      import assert from 'node:assert/strict'
      import { runAutomation } from './server/automation/worker.ts'
      import { requestStop, shutdownSignal } from './server/browser/lifecycle.ts'
      const pending = ${JSON.stringify(pending)}
      let closed = 0
      const snapshot = {automation:{status:'running',isActive:true},profiles:[{id:'p',name:'fixture',modelIds:['m'],igLoggedIn:true,inUse:false}]}
      function subscription(kind, value, update, signal) {
        assert.equal(signal, shutdownSignal)
        if (kind !== pending) {
          update(value)
          return {initial:Promise.resolve(value),unsubscribe() {closed++}}
        }
        const initial = new Promise((_,reject) => signal.addEventListener('abort', () => reject(signal.reason), {once:true}))
        queueMicrotask(requestStop)
        return {initial,unsubscribe() {closed++}}
      }
      const automation = pending === 'routine access' ? {modelIds:['m'],routine:{activity:{}}}
        : {nodes:[{id:'start',type:'start',data:{config:{sourceLists:['m']}}}],edges:[]}
      await assert.rejects(runAutomation({automation}, {
        openSession: async () => {throw Error('Must not open a browser')},
        watchRuntime: (_id,_lists,update,_error,signal) => subscription('runtime',snapshot,update,signal),
        watchRoutineAccess: (_id,_profile,update,_error,signal) => subscription('routine access',true,update,signal),
        watchProfileAccess: (_profile,update,_error,signal) => subscription('profile access',true,update,signal),
      }), error => error === shutdownSignal.reason)
      assert.equal(closed, pending === 'runtime' ? 1 : 2)
    `], { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, 0, result.stderr)
  })

for (const actionFails of [false, true]) {
  test(`cleanup failures are visible and never replace an earlier action failure (${actionFails})`, async () => {
    const originalFetch = globalThis.fetch
    const originalWrite = process.stdout.write
    const events: Array<Record<string, unknown>> = []
    let closes = 0
    globalThis.fetch = (async () => Response.json({})) as typeof fetch
    process.stdout.write = ((chunk: unknown, callback?: () => void) => {
      const text = String(chunk)
      if (text.startsWith('__EVENT__')) events.push(JSON.parse(text.trim().slice(9, -9)))
      callback?.()
      return true
    }) as typeof process.stdout.write
    const snapshot: RuntimeSnapshot = {
      automation: { status: 'running', isActive: true },
      profiles: [profile],
    }
    const deps: Partial<WorkerDependencies> = {
      openSession: async () =>
        ({
          page: {},
          close: async () => {
            closes++
            throw new Error('Cookies could not be saved')
          },
        }) as unknown as BrowserSession,
      watchRuntime: (_id, _lists, update) => {
        update(snapshot)
        return { initial: Promise.resolve(snapshot), unsubscribe() {} }
      },
      watchProfileAccess: (_id, update) => {
        update(true)
        return { initial: Promise.resolve(true), unsubscribe() {} }
      },
    }
    try {
      await assert.rejects(
        runAutomation(
          {
            automation: {
              nodes: [{ id: 'start', type: 'start', data: { config: { sourceLists: ['model'] } } }],
              edges: actionFails ? [{ source: 'start', target: 'bad', sourceHandle: 'next' }] : [],
            },
          },
          deps,
        ),
        actionFails ? /Automation edge points to missing node/ : /Cookies could not be saved/,
      )
      assert.equal(closes, 1)
      assert.equal(
        events.some((event) => event.type === 'profile_completed'),
        false,
      )
      assert.equal(
        events.some((event) => event.type === 'error'),
        true,
      )
    } finally {
      globalThis.fetch = originalFetch
      process.stdout.write = originalWrite
    }
  })
}

test('an injected browser opener retains access checks and post-session model setup', async () => {
  const originalFetch = globalThis.fetch
  let opened = 0,
    setup = 0,
    posted = 0,
    unsubscribed = 0
  let active = true
  let updateAccess!: (allowed: boolean) => void
  let notify!: (snapshot: RuntimeSnapshot) => void
  const snapshot = { automation: { isActive: true, status: 'running' }, profiles: [profile] }
  globalThis.fetch = (async (url) =>
    Response.json(
      String(url).endsWith('/api/routines/ready') || String(url).endsWith('/api/warmup/prepare'),
    )) as typeof fetch
  const dependencies: Partial<WorkerDependencies> = {
    openSession: async () => {
      opened++
      return {
        page: {},
        close: async () =>
          notify({ ...snapshot, automation: { isActive: false, status: 'cancelled' } }),
      } as unknown as BrowserSession
    },
    watchRuntime: (_id, _lists, update) => {
      notify = update
      update(snapshot)
      return {
        initial: Promise.resolve(snapshot),
        unsubscribe() {
          unsubscribed++
        },
      }
    },
    watchRoutineAccess: (_a, _p, update) => {
      updateAccess = update
      update(active)
      return {
        initial: Promise.resolve(active),
        unsubscribe() {
          unsubscribed++
        },
      }
    },
    setupModel: async () => {
      setup++
      return true
    },
    postModelUpdate: async () => {
      posted++
      return true
    },
  }
  const input = {
    automationId: 'a',
    automation: { modelIds: ['model'], routine: { activity: {} } },
  }
  try {
    // routineReady's checkpoint returns false, skipping browsing while keeping setup live.
    globalThis.fetch = (async (url, init) =>
      Response.json(
        String(url).endsWith('/api/routines/ready')
          ? !JSON.parse(String(init?.body)).checkpoint
          : String(url).endsWith('/api/warmup/prepare'),
      )) as typeof fetch
    await runAutomation(input, dependencies)
    assert.deepEqual([opened, setup, posted], [1, 1, 1])
    active = false
    await runAutomation({ ...input, yieldWhenIdle: true }, dependencies)
    assert.deepEqual([opened, setup, posted], [1, 1, 1])
    assert.equal(unsubscribed, 4)
    active = true
    await runAutomation(input, { ...dependencies, setupModel: async () => {
      setup++
      updateAccess(false)
      return true
    } })
    assert.deepEqual([opened, setup, posted], [2, 2, 1])
    assert.equal(unsubscribed, 6)
  } finally {
    globalThis.fetch = originalFetch
  }
})
