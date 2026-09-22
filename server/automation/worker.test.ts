import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { BrowserSession } from '../browser/cloak.js'
import { runAutomation, setProfilePollIntervalMs } from './worker.js'

for (const initialState of ['empty', 'busy', 'cooldown'] as const) {
  test(`initially ${initialState} profiles are picked up when available`, async () => {
    const originalFetch = globalThis.fetch
    setProfilePollIntervalMs(1)
    let reads = 0
    let checks = 0
    const opened: string[] = []
    globalThis.fetch = (async url => {
      const u = String(url)
      if (u.endsWith('/api/profiles')) {
        const first = ++reads === 1
        return Response.json(first && initialState === 'empty' ? [] : [{
          id: 'chosen', name: 'chosen', listIds: ['chosen'],
          using: first && initialState === 'busy',
          lastOpenedAt: first && initialState === 'cooldown' ? Date.now() : 0,
        }])
      }
      if (u.includes('/api/automations/by-id')) {
        return Response.json({ status: ++checks === 1 ? 'pending' : opened.length ? 'completed' : 'running', isActive: true })
      }
      return Response.json({})
    }) as typeof fetch
    try {
      await runAutomation({ automation: { nodes: [{
        id: 'start_node', type: 'start', data: { config: {
          sourceLists: ['chosen'], profileReopenCooldownEnabled: true, profileReopenCooldownMinutes: 30,
        } },
      }] } }, async name => {
        opened.push(name)
        return { page: {}, close: async () => {} } as unknown as BrowserSession
      })
      assert.deepEqual(opened, ['chosen'])
      assert.equal(reads, 2)
    } finally {
      globalThis.fetch = originalFetch
      setProfilePollIntervalMs(5 * 60 * 1000)
    }
  })
}

test('standalone stories use configured viewing times', async () => {
  const originalFetch = globalThis.fetch
  const originalTimeout = globalThis.setTimeout
  const delays: number[] = []
  globalThis.setTimeout = ((callback: (...args: any[]) => void, ms?: number, ...args: any[]) => {
    delays.push(ms ?? 0)
    return originalTimeout(callback, 0, ...args)
  }) as typeof setTimeout
  globalThis.fetch = (async url => Response.json(String(url).endsWith('/api/profiles')
    ? [{ id: 'chosen', name: 'chosen', listIds: ['chosen'], using: false }] : {})) as typeof fetch
  try {
    await runAutomation({ automation: {
      nodes: [
        { id: 'start_node', type: 'start', data: { config: { sourceLists: ['chosen'] } } },
        { id: 'stories', data: { activityId: 'watch_stories', config: {
          stories_max: 1, stories_min_view_seconds: 12, stories_max_view_seconds: 15,
        } } },
      ],
      edges: [{ source: 'start_node', target: 'stories', sourceHandle: 'next' }],
    } }, async () => ({
      page: {
        goto: async () => {},
        keyboard: { press: async () => {} },
        getByRole: () => ({
          count: async () => 0,
          nth: () => ({ isVisible: async () => false, click: async () => {} }),
          getByRole: () => ({
            first: () => ({
              isVisible: async () => false,
              waitFor: async () => { throw new Error('missing') },
              click: async () => {},
            }),
          }),
          first: () => ({ isVisible: async () => false, click: async () => {} }),
        }),
        locator: () => ({
          first: () => ({ isVisible: async () => true, click: async () => {} }),
          count: async () => 0,
          nth: () => ({ isVisible: async () => false, click: async () => {} }),
        }),
      },
      close: async () => {},
    } as unknown as BrowserSession))
    assert.equal(delays.length, 1)
    assert.ok(delays[0] >= 12_000 && delays[0] <= 15_000, `Unexpected viewing delay: ${delays[0]}`)
  } finally {
    globalThis.fetch = originalFetch
    globalThis.setTimeout = originalTimeout
  }
})

test('retry skips completed profiles without launching or changing their status', async () => {
  const originalFetch = globalThis.fetch
  let launches = 0
  globalThis.fetch = (async url => {
    assert.ok(String(url).endsWith('/api/profiles'))
    return Response.json([{ name: 'done', id: 'done', listIds: ['chosen'], using: false }])
  }) as typeof fetch
  try {
    await runAutomation({ automation: {
      nodes: [{ id: 'start_node', type: 'start', data: { config: { sourceLists: ['chosen'] } } }],
      nodeStates: { __profileRuns: { done: { completed: true } } },
    } }, async () => { launches++; throw new Error('Must not launch') })
    assert.equal(launches, 0)
  } finally { globalThis.fetch = originalFetch }
})

test('repeating warm-ups requeue completed profiles but never open resting or exhausted profiles', async () => {
  const originalFetch = globalThis.fetch
  setProfilePollIntervalMs(10)
  const date = new Date().toISOString().slice(0, 10)
  const profiles = ['ready', 'resting', 'exhausted'].map(id => ({ name: id, id, listIds: ['chosen'], using: false }))
  let used = 0
  let nextRunAt = 0
  let checks = 0
  globalThis.fetch = (async url => {
    const u = String(url)
    if (u.endsWith('/api/profiles')) return Response.json(profiles)
    if (u.includes('/api/warmup/by-profile')) {
      const id = new URL(u).searchParams.get('profileId')
      return Response.json({ date, todayMinutes: 20, reservedMinutes: 0,
        minutesUsedToday: id === 'exhausted' ? 20 : used,
        nextRunAt: id === 'resting' ? Date.now() + 60_000 : nextRunAt })
    }
    // Scheduling test: skip browser actions; closing simulates completed session accounting.
    if (u.endsWith('/api/warmup/begin')) return Response.json({ date, minutes: 0 })
    if (u.includes('/api/automations/by-id')) return Response.json({ status: ++checks <= 12 ? 'running' : 'completed' })
    return Response.json({})
  }) as typeof fetch
  const opened: string[] = []
  try {
    await runAutomation({ automation: {
      nodes: [
        { id: 'start_node', type: 'start', data: { config: { sourceLists: ['chosen'], repeatWhileActive: true } } },
        { id: 'warm', data: { activityId: 'browse_feed' } },
      ],
      edges: [{ source: 'start_node', target: 'warm', sourceHandle: 'next' }],
      nodeStates: { __profileRuns: { ready: { completed: true, date } } },
    } }, async name => {
      assert.ok(Date.now() >= nextRunAt)
      opened.push(name)
      return { page: {}, close: async () => { used += 10; nextRunAt = Date.now() + 20 } } as unknown as BrowserSession
    })
    assert.deepEqual(opened, ['ready', 'ready'])
  } finally { globalThis.fetch = originalFetch; setProfilePollIntervalMs(5 * 60 * 1000) }
})

test('close browser ends the session and final cleanup stays safe', async () => {
  const originalFetch = globalThis.fetch
  const profile = { name: 'chosen', id: 'chosen', listIds: ['chosen'], using: false }
  globalThis.fetch = (async url => Response.json(String(url).endsWith('/api/profiles') ? [profile] : {})) as typeof fetch
  const sessions: Array<{ closed: boolean; visits: number }> = []
  try {
    await runAutomation({ automation: {
      nodes: [
        { id: 'start_node', type: 'start', data: { config: { sourceLists: ['chosen'] } } },
        { id: 'close', data: { activityId: 'close_browser' } },
      ],
      edges: [{ source: 'start_node', target: 'close', sourceHandle: 'next' }],
    } }, async () => {
      const state = { closed: false, visits: 0 }
      sessions.push(state)
      return { page: { goto: async () => { assert.equal(state.closed, false); state.visits++ } }, close: async () => { state.closed = true } } as unknown as BrowserSession
    })
    assert.deepEqual(sessions, [{ closed: true, visits: 0 }])
  } finally { globalThis.fetch = originalFetch }
})

test('nodes after close browser never run against the closed session', async () => {
  const originalFetch = globalThis.fetch
  const profile = { name: 'chosen', id: 'chosen', listIds: ['chosen'], using: false }
  globalThis.fetch = (async url => Response.json(String(url).endsWith('/api/profiles') ? [profile] : {})) as typeof fetch
  let navigations = 0
  try {
    await runAutomation({ automation: {
      nodes: [
        { id: 'start_node', type: 'start', data: { config: { sourceLists: ['chosen'] } } },
        { id: 'close', data: { activityId: 'close_browser' } },
        { id: 'feed', data: { activityId: 'browse_feed', config: { feed_min_time_minutes: 0, feed_max_time_minutes: 0 } } },
      ],
      edges: [
        { source: 'start_node', target: 'close', sourceHandle: 'next' },
        { source: 'close', target: 'feed', sourceHandle: 'next' },
      ],
    } }, async () => ({
      page: { goto: async () => { navigations++ } },
      close: async () => {},
    } as unknown as BrowserSession))
    assert.equal(navigations, 0)
  } finally { globalThis.fetch = originalFetch }
})

test('automation action failures reject the run and close the browser', async () => {
  const originalFetch = globalThis.fetch
  let closed = false
  const statuses: string[] = []
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith('/api/profiles'))
      return Response.json([
        {
          name: 'excluded',
          id: 'other',
          listIds: ['other'],
          using: false,
        },
        {
          name: 'chosen',
          id: 'chosen',
          listIds: ['chosen'],
          using: false,
        },
      ])
    if (String(url).includes('/api/warmup/by-profile')) return Response.json(null)
    if (String(url).endsWith('/api/warmup/begin')) return Response.json({ date: new Date().toISOString().slice(0, 10), minutes: 30 })
    if (String(url).endsWith('/api/warmup/finish')) return Response.json({ ok: true })
    assert.match(String(url), /sync-status$/)
    statuses.push(JSON.parse(String(init?.body)).status)
    return Response.json({})
  }) as typeof fetch
  try {
    await assert.rejects(
      runAutomation(
        {
          automationId: 'test',
          automation: {
            nodes: [
              {
                id: 'start_node',
                type: 'start',
                data: {
                  config: { sourceLists: ['chosen'] },
                },
              },
              { id: 'feed', data: { activityId: 'browse_feed' } },
            ],
            edges: [{ source: 'start_node', target: 'feed', sourceHandle: 'next' }],
          },
        },
        async (name) => {
          assert.equal(name, 'chosen')
          return {
            page: {
              goto: async () => {
                throw new Error('Navigation failed')
              },
            },
            close: async () => {
              closed = true
            },
          } as unknown as BrowserSession
        },
      ),
      /Navigation failed/,
    )
    assert.equal(closed, true)
    assert.deepEqual(statuses, ['running', 'idle'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('browser startup failures never clear another session’s busy status', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    calls++
    assert.match(String(url), /api\/profiles$/)
    return Response.json([
      {
        name: 'chosen',
        id: 'chosen',
        listIds: ['chosen'],
        using: false,
      },
    ])
  }) as typeof fetch
  try {
    await assert.rejects(
      runAutomation(
        {
          automation: {
            nodes: [
              {
                id: 'start_node',
                type: 'start',
                data: {
                  config: { sourceLists: ['chosen'] },
                },
              },
            ],
          },
        },
        async () => {
          throw new Error('Profile is already open')
        },
      ),
      /Profile is already open/,
    )
    assert.equal(calls, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('running automations pick up newly added profiles on each poll', async () => {
  setProfilePollIntervalMs(10)
  const originalFetch = globalThis.fetch
  const profiles = [{ name: 'old', id: 'old', listIds: ['chosen'], using: false, proxy: 'proxy-a:8080' }]
  let watchChecks = 0
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    const u = String(url)
    if (u.endsWith('/api/profiles')) return Response.json(profiles)
    if (u.includes('/api/automations/by-id')) {
      watchChecks++
      if (watchChecks <= 2) {
        if (watchChecks === 1) {
          profiles.push(
            { name: 'same', id: 'same', listIds: ['chosen'], using: false, proxy: 'proxy-a:8080' },
            { name: 'different', id: 'different', listIds: ['chosen'], using: false, proxy: 'proxy-b:8080' },
          )
        }
        return Response.json({ status: 'running', isActive: true })
      }
      return Response.json({ status: 'completed', isActive: true })
    }
    return Response.json({})
  }) as typeof fetch
  const opened: string[] = []
  try {
    await runAutomation(
      {
        automationId: 'test',
        automation: {
          nodes: [
            { id: 'start_node', type: 'start', data: { config: { sourceLists: ['chosen'] } } },
            { id: 'close', data: { activityId: 'close_browser' } },
          ],
          edges: [{ source: 'start_node', target: 'close', sourceHandle: 'next' }],
        },
      },
      async (name) => {
        opened.push(name)
        return { page: {}, close: async () => {} } as unknown as BrowserSession
      },
    )
    assert.deepEqual(opened, ['old', 'different', 'same'])
    assert.equal(watchChecks, 3)
  } finally {
    globalThis.fetch = originalFetch
    setProfilePollIntervalMs(5 * 60 * 1000)
  }
})

test('queue interleaves proxies after excluding completed checkpoints', async () => {
  const originalFetch = globalThis.fetch
  const profiles = ['a1', 'a2', 'b1', 'b2', 'b3'].map(id => ({
    id, name: id, listIds: ['chosen'], using: false, proxy: `proxy-${id[0]}:8080`,
  }))
  globalThis.fetch = (async url => Response.json(String(url).endsWith('/api/profiles') ? profiles : {})) as typeof fetch
  const opened: string[] = []
  try {
    await runAutomation({ automation: {
      nodes: [{ id: 'start_node', type: 'start', data: { config: { sourceLists: ['chosen'] } } }],
      nodeStates: { __profileRuns: { b2: { completed: true }, b3: { completed: true } } },
    } }, async name => {
      opened.push(name)
      return { page: {}, close: async () => {} } as unknown as BrowserSession
    })
    assert.deepEqual(opened, ['a1', 'b1', 'a2'])
  } finally { globalThis.fetch = originalFetch }
})
