import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CamoufoxSession } from '../browser/camoufox.js'
import { runWorkflow } from './worker.js'

test('workflow action failures reject the run and close the browser', async () => {
  const originalFetch = globalThis.fetch
  let closed = false
  const statuses: string[] = []
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith('/api/profiles'))
      return Response.json([
        {
          name: 'excluded',
          profile_id: 'other',
          list_ids: ['other'],
          login: true,
          Using: false,
        },
        {
          name: 'chosen',
          profile_id: 'chosen',
          list_ids: ['chosen'],
          login: true,
          Using: false,
        },
      ])
    assert.match(String(url), /sync-status$/)
    statuses.push(JSON.parse(String(init?.body)).status)
    return Response.json({})
  }) as typeof fetch
  try {
    await assert.rejects(
      runWorkflow(
        {
          workflowId: 'test',
          workflow: {
            nodes: [
              {
                id: 'select',
                data: {
                  activityId: 'select_list',
                  config: { sourceLists: ['chosen'] },
                },
              },
              { id: 'feed', data: { activityId: 'browse_feed' } },
            ],
            edges: [{ source: 'select', target: 'feed', sourceHandle: 'next' }],
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
          } as unknown as CamoufoxSession
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
        profile_id: 'chosen',
        list_ids: ['chosen'],
        login: true,
        Using: false,
      },
    ])
  }) as typeof fetch
  try {
    await assert.rejects(
      runWorkflow(
        {
          workflow: {
            nodes: [
              {
                id: 'select',
                data: {
                  activityId: 'select_list',
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
