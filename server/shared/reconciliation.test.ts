import { test } from 'node:test'
import assert from 'node:assert/strict'
import { automationsReconcileInterrupted } from './convexClient.js'

test('startup waits for all recovery batches and totals reconciled automations', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  const batches = [{ reconciled: 100, hasMore: true }, { reconciled: 3, hasMore: true }, { reconciled: 0 }]
  globalThis.fetch = (async url => {
    assert.ok(String(url).endsWith('/api/automations/reconcile'))
    return Response.json(batches[calls++])
  }) as typeof fetch
  try {
    assert.deepEqual(await automationsReconcileInterrupted(), { reconciled: 103 })
    assert.equal(calls, 3)
  } finally { globalThis.fetch = originalFetch }
})
