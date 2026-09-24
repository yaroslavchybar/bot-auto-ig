import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

process.env.VITE_CONVEX_URL ??= 'https://example.invalid'
const { apiFetch, apiFetchBlob, setTokenGetter, withRetry } = await import('./api')

test('zero configured retries still makes the first request', async () => {
  let attempts = 0
  const result = await withRetry(async () => { attempts++; return 'sent' }, { maxRetries: 0 })
  assert.equal(result, 'sent')
  assert.equal(attempts, 1)
})

test('upload blobs preserve binary bytes and use the normal authentication', async () => {
  const bytes = Buffer.from([0, 255, 128, 1])
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({
      bytes: Array.from(Buffer.concat(chunks)),
      auth: req.headers.authorization,
      type: req.headers['content-type'],
    }))
  }).listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  setTokenGetter(() => Promise.resolve('test-token'))
  try {
    const result = await apiFetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { method: 'POST', body: new Blob([bytes]) })
    assert.deepEqual(result, { bytes: Array.from(bytes), auth: 'Bearer test-token', type: 'application/octet-stream' })
  } finally {
    setTokenGetter(() => Promise.resolve(null))
    server.closeAllConnections()
    server.close()
  }
})

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

test('binary requests preserve JPEG bytes, authentication, errors and body timeout', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xd9])
  const server = createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer test-token') {
      res.writeHead(401).end('missing token')
    } else if (req.url === '/error') {
      res.writeHead(404).end('display ended')
    } else {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' })
      res.write(jpeg)
      if (req.url !== '/slow') res.end()
    }
  }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  setTokenGetter(() => Promise.resolve('test-token'))
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const blob = await apiFetchBlob(base, { maxRetries: 1 })
    assert.equal(blob.type, 'image/jpeg')
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), jpeg)
    await assert.rejects(apiFetchBlob(`${base}/error`, { maxRetries: 1 }), { status: 404 })
    await assert.rejects(apiFetchBlob(`${base}/slow`, { timeout: 100, maxRetries: 1 }), { name: 'AbortError' })
  } finally {
    setTokenGetter(() => Promise.resolve(null))
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
