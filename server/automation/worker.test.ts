import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { BrowserSession } from '../browser/cloak.js'
import { runAutomation } from './worker.js'

test('retry skips completed profiles without launching or changing their status', async () => {
  const originalFetch = globalThis.fetch
  let launches = 0
  globalThis.fetch = (async url => {
    assert.ok(String(url).endsWith('/api/profiles'))
    return Response.json([{ name: 'done', id: 'done', listIds: ['chosen'], login: true, using: false }])
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
  const profile = { name: 'chosen', id: 'chosen', listIds: ['chosen'], login: true, using: false }
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
  const profile = { name: 'chosen', id: 'chosen', listIds: ['chosen'], login: true, using: false }
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
          login: true,
          using: false,
        },
        {
          name: 'chosen',
          id: 'chosen',
          listIds: ['chosen'],
          login: true,
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
        login: true,
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
