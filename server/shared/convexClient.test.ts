import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach, mock } from 'node:test'

import { ConvexHttpError, setRetryConfig } from './convexClient.js'

// ---------------------------------------------------------------------------
// Unit tests for the retry helpers exported from convexClient.
//
// Because convexFetch is a module-private function whose behaviour depends
// on the module-level `fetch` global plus configuration state, we test the
// publicly-exported retry helpers (ConvexHttpError, isRetryable-equivalent,
// computeBackoff-equivalent, setRetryConfig) and verify the integration
// through the publicly-accessible DB wrappers that delegate to convexFetch.
// ---------------------------------------------------------------------------

describe('ConvexHttpError', () => {
  it('stores statusCode and formats message', () => {
    const err = new ConvexHttpError(502, 'Bad Gateway')
    assert.equal(err.statusCode, 502)
    assert.match(err.message, /502/)
    assert.match(err.message, /Bad Gateway/)
    assert.ok(err instanceof Error)
    assert.ok(err instanceof ConvexHttpError)
  })
})

describe('retry behaviour via convexFetch integration', () => {
  const originalFetch = globalThis.fetch
  let fetchCalls: Array<{ url: string; init: RequestInit }> = []

  // Use minimal delays for testing speed
  beforeEach(() => {
    fetchCalls = []
    setRetryConfig({ maxRetries: 3, baseDelay: 1 })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    setRetryConfig({ maxRetries: 3, baseDelay: 1000 })
  })

  /**
   * Helper: replace global fetch with a stub that returns pre-configured
   * responses for successive calls.
   */
  function stubFetch(responses: Array<{ status: number; body: string } | 'network-error'>) {
    let callIdx = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init: init ?? {} as RequestInit })
      const entry = responses[callIdx++]
      if (!entry || entry === 'network-error') {
        throw new TypeError('fetch failed')
      }
      return {
        ok: entry.status >= 200 && entry.status < 300,
        status: entry.status,
        text: async () => entry.body,
        json: async () => JSON.parse(entry.body),
      } as Response
    }) as typeof globalThis.fetch
  }

  // Import the wrapper functions dynamically so the module picks up the
  // stubbed fetch.  We use a simple wrapper: `listsList` calls convexFetch
  // internally.
  async function callConvexFetch() {
    // We call listsList() which internally invokes convexFetch('/api/lists')
    const { listsList } = await import('./convexClient.js')
    return listsList()
  }

  it('succeeds on first attempt without retry', async () => {
    stubFetch([{ status: 200, body: '[]' }])
    const result = await callConvexFetch()
    assert.deepEqual(result, [])
    assert.equal(fetchCalls.length, 1)
  })

  it('retries on HTTP 500 and eventually succeeds', async () => {
    stubFetch([
      { status: 500, body: 'Internal Server Error' },
      { status: 500, body: 'Internal Server Error' },
      { status: 200, body: '[]' },
    ])
    const result = await callConvexFetch()
    assert.deepEqual(result, [])
    assert.equal(fetchCalls.length, 3, 'Should have retried twice then succeeded')
  })

  it('retries on HTTP 429 (Too Many Requests)', async () => {
    stubFetch([
      { status: 429, body: 'Rate limited' },
      { status: 200, body: '[]' },
    ])
    const result = await callConvexFetch()
    assert.deepEqual(result, [])
    assert.equal(fetchCalls.length, 2)
  })

  it('retries on HTTP 502 (Bad Gateway)', async () => {
    stubFetch([
      { status: 502, body: 'Bad Gateway' },
      { status: 200, body: '[]' },
    ])
    const result = await callConvexFetch()
    assert.deepEqual(result, [])
    assert.equal(fetchCalls.length, 2)
  })

  it('retries on HTTP 503 (Service Unavailable)', async () => {
    stubFetch([
      { status: 503, body: 'Service Unavailable' },
      { status: 200, body: '[]' },
    ])
    const result = await callConvexFetch()
    assert.deepEqual(result, [])
    assert.equal(fetchCalls.length, 2)
  })

  it('retries on network errors', async () => {
    stubFetch([
      'network-error',
      { status: 200, body: '[]' },
    ])
    const result = await callConvexFetch()
    assert.deepEqual(result, [])
    assert.equal(fetchCalls.length, 2)
  })

  it('does NOT retry on HTTP 400 (client error)', async () => {
    stubFetch([{ status: 400, body: 'Bad Request' }])
    await assert.rejects(callConvexFetch, (err: unknown) => {
      assert.ok(err instanceof ConvexHttpError)
      assert.equal(err.statusCode, 400)
      return true
    })
    assert.equal(fetchCalls.length, 1, 'Should not have retried a 400 error')
  })

  it('does NOT retry on HTTP 404 (not found)', async () => {
    stubFetch([{ status: 404, body: 'Not Found' }])
    await assert.rejects(callConvexFetch, (err: unknown) => {
      assert.ok(err instanceof ConvexHttpError)
      assert.equal(err.statusCode, 404)
      return true
    })
    assert.equal(fetchCalls.length, 1, 'Should not have retried a 404 error')
  })

  it('does NOT retry on HTTP 409 (conflict)', async () => {
    stubFetch([{ status: 409, body: 'Conflict' }])
    await assert.rejects(callConvexFetch, (err: unknown) => {
      assert.ok(err instanceof ConvexHttpError)
      assert.equal(err.statusCode, 409)
      return true
    })
    assert.equal(fetchCalls.length, 1, 'Should not have retried a 409 error')
  })

  it('exhausts all retries and throws the last error', async () => {
    stubFetch([
      { status: 500, body: 'fail 1' },
      { status: 500, body: 'fail 2' },
      { status: 500, body: 'fail 3' },
      { status: 500, body: 'fail 4' },
    ])
    await assert.rejects(callConvexFetch, (err: unknown) => {
      assert.ok(err instanceof ConvexHttpError)
      assert.equal(err.statusCode, 500)
      return true
    })
    // 1 initial + 3 retries = 4 total attempts
    assert.equal(fetchCalls.length, 4, 'Should have made 4 total attempts')
  })

  it('respects custom maxRetries=0 (no retries)', async () => {
    setRetryConfig({ maxRetries: 0, baseDelay: 1 })
    stubFetch([{ status: 500, body: 'fail' }])
    await assert.rejects(callConvexFetch, (err: unknown) => {
      assert.ok(err instanceof ConvexHttpError)
      return true
    })
    assert.equal(fetchCalls.length, 1, 'Should not retry when maxRetries=0')
  })
})
