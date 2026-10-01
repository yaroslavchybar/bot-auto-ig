import { test } from 'node:test'
import assert from 'node:assert/strict'
import { automationsReconcileInterrupted } from './convexClient.js'

test('startup waits for all recovery batches and totals reconciled automations', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  const batches = [{ reconciled: 0, hasMore: true, cursor: 'page-1' }, { reconciled: 3, hasMore: true, cursor: 'page-2' }, { reconciled: 0 }]
  const bodies = [{}, { cursor: 'page-1' }, { cursor: 'page-2' }]
  globalThis.fetch = (async (url, init) => {
    assert.ok(String(url).endsWith('/api/automations/reconcile'))
    assert.deepEqual(JSON.parse(String(init?.body)), bodies[calls])
    return Response.json(batches[calls++])
  }) as typeof fetch
  try {
    assert.deepEqual(await automationsReconcileInterrupted(), { reconciled: 3 })
    assert.equal(calls, 3)
  } finally { globalThis.fetch = originalFetch }
})
