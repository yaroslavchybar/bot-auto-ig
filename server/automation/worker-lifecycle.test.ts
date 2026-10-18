import test from 'node:test'
import assert from 'node:assert/strict'
import { runAutomation, type WorkerDependencies } from './worker.js'
import type { BrowserSession } from '../browser/cloak.js'
import type { RuntimeSnapshot } from '../shared/convexRealtime.js'

const profile = { id: 'p', name: 'Profile', modelIds: ['model'], igLoggedIn: true, inUse: false }

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
