import { expect, test, vi } from 'vitest'
import { createConvexTest } from './helpers'

test('Convex HTTP logs one event per request, propagates IDs and omits sensitive payloads', async () => {
  const t = createConvexTest()
  vi.stubGlobal('process', { env: { INTERNAL_API_KEY: 'secret-token', COMMIT_SHA: 'test-commit' } })
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const authorized = await t.fetch('/api/profiles', {
    method: 'POST', headers: { authorization: 'Bearer secret-token', 'content-type': 'application/json', 'x-request-id': 'test-request-123' },
    body: JSON.stringify({ name: 'Log Test', cookiesJson: '[{"name":"sessionid","value":"private-cookie","domain":".instagram.com","path":"/"}]' }),
  })
  expect(authorized.status).toBe(200)
  expect(authorized.headers.get('x-request-id')).toBe('test-request-123')
  await t.fetch('/api/lists', { headers: { 'x-request-id': 'invalid id' } })
  const logs = info.mock.calls.map(call => JSON.parse(String(call[0])))
  expect(logs).toHaveLength(2)
  expect(error).not.toHaveBeenCalled()
  expect(logs[0]).toMatchObject({ event: 'http.request', requestId: 'test-request-123', level: 'info', outcome: 'success', environment: { commitHash: 'test-commit' } })
  expect(logs[1]).toMatchObject({ outcome: 'rejected', context: { statusCode: 401 } })
  expect(logs[1].requestId).not.toBe('invalid id')
  expect(JSON.stringify(logs)).not.toContain('private-cookie')
  expect(JSON.stringify(logs)).not.toContain('secret-token')
})

test('missing Convex authentication configuration emits a completed error event', async () => {
  const t = createConvexTest()
  vi.stubGlobal('process', { env: {} })
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const response = await t.fetch('/api/lists')
  expect(response.status).toBe(500)
  expect(error).toHaveBeenCalledTimes(1)
  expect(JSON.parse(String(error.mock.calls[0][0]))).toMatchObject({ outcome: 'error', level: 'error', context: { statusCode: 500 } })
})
