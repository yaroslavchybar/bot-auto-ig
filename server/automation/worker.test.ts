import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { BrowserSession } from '../browser/cloak.js'
import { planWarmupRun, runAutomation, setProfilePollIntervalMs } from './worker.js'

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

test('warm-up duration never exceeds the remaining daily budget', () => {
  const config = { warmup_min_minutes: 30, warmup_max_minutes: 60 }
  const today = '2026-01-01'

  const fresh = planWarmupRun(
    { date: today, todayMinutes: 40, minutesUsedToday: 35 },
    config,
    today,
  )
  assert.equal(fresh.todayMinutes, 40)
  assert.ok(fresh.minutes <= 5, `expected capped minutes, got ${fresh.minutes}`)
  assert.ok(fresh.minutes >= 0)

  const exhausted = planWarmupRun(
    { date: today, todayMinutes: 40, minutesUsedToday: 40 },
    config,
    today,
  )
  assert.equal(exhausted.minutes, 0)

  const noState = planWarmupRun(null, config, '2026-01-02')
  assert.ok(noState.todayMinutes >= 30 && noState.todayMinutes <= 60)
  assert.ok(noState.minutes <= noState.todayMinutes)
})

test('running automations pick up newly added profiles on each poll', async () => {
  setProfilePollIntervalMs(10)
  const originalFetch = globalThis.fetch
  const profiles = [{ name: 'old', id: 'old', listIds: ['chosen'], using: false }]
  let watchChecks = 0
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    const u = String(url)
    if (u.endsWith('/api/profiles')) return Response.json(profiles)
    if (u.includes('/api/automations/by-id')) {
      watchChecks++
      if (watchChecks <= 2) {
        if (watchChecks === 1) {
          profiles.push({ name: 'new', id: 'new', listIds: ['chosen'], using: false })
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
    assert.deepEqual(opened, ['old', 'new'])
    assert.equal(watchChecks, 3)
  } finally {
    globalThis.fetch = originalFetch
    setProfilePollIntervalMs(5 * 60 * 1000)
  }
})
