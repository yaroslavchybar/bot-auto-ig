import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

process.env.VITE_CONVEX_URL ??= 'https://example.invalid'
const { apiFetch, setTokenGetter } = await import('./api')

test('cancel and timeout both stop waiting for a stalled auth token', async () => {
  setTokenGetter(() => new Promise(() => {}))
  try {
    const controller = new AbortController()
    const cancelled = apiFetch('/unused', { signal: controller.signal, maxRetries: 1 })
    controller.abort()
    await assert.rejects(cancelled, { name: 'AbortError' })
    await assert.rejects(apiFetch('/unused', { timeout: 10, maxRetries: 1 }), { name: 'AbortError' })
  } finally { setTokenGetter(() => Promise.resolve(null)) }
})

test('request timeout stays active while the response body is loading', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.write('{') // headers arrive, but the body never finishes
  }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/slow`
    await assert.rejects(apiFetch(url, { timeout: 100, maxRetries: 1 }), { name: 'AbortError' })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
