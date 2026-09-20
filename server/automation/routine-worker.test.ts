import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runAutomation } from './worker.js'
import type { BrowserSession } from '../browser/cloak.js'

test('a failed profile does not prevent the next eligible profile from starting', async () => {
  const originalFetch = globalThis.fetch
  const opened: string[] = [], issues: string[] = []
  globalThis.fetch = (async (url, options) => {
    const path = String(url)
    if (path.endsWith('/api/profiles')) return Response.json(['broken', 'healthy'].map(name => ({ id: name, name, listIds: ['list'], using: false })))
    if (path.endsWith('/api/routines/ready')) {
      const body = JSON.parse(String(options?.body))
      return Response.json(!body.checkpoint)
    }
    if (path.endsWith('/api/routines/session')) {
      const body = JSON.parse(String(options?.body))
      if (body.issue) issues.push(body.profileId)
    }
    if (path.includes('/api/automations/by-id')) return Response.json({ status: 'completed', isActive: false })
    return Response.json({})
  }) as typeof fetch
  try {
    await runAutomation({ automationId: 'routine', automation: { _id: 'routine', nodes: [], edges: [], listIds: ['list'], routine: { headless: true, activity: {} } } }, async name => {
      opened.push(name)
      if (name === 'broken') throw new Error('Browser startup failed')
      return { page: {}, close: async () => {} } as unknown as BrowserSession
    })
    assert.deepEqual(opened, ['broken', 'healthy'])
    assert.deepEqual(issues, ['broken'])
  } finally { globalThis.fetch = originalFetch }
})
