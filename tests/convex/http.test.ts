import { expect, test, vi } from 'vitest'

import { api } from '../../convex/_generated/api'
import { createConvexTest, seedList, seedProfile, seedWorkflow } from './helpers'

function stubEnv(env: Record<string, string>) {
  vi.stubGlobal('process', { env })
}

test('rejects unauthorized requests when INTERNAL_API_KEY is configured', async () => {
  const t = createConvexTest()
  stubEnv({ INTERNAL_API_KEY: 'secret-token' })

  const response = await t.fetch('/api/lists', { method: 'GET' })

  expect(response.status).toBe(401)
  await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
})

test('maps list responses for authorized requests', async () => {
  const t = createConvexTest()
  const list = await seedList(t, 'Leads')
  stubEnv({ INTERNAL_API_KEY: 'secret-token' })

  const response = await t.fetch('/api/lists', {
    method: 'GET',
    headers: { authorization: 'Bearer secret-token' },
  })
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(body).toEqual([{ id: list!._id, name: 'Leads' }])
})

test('parses snake_case profile payloads and maps the response back to Python fields', async () => {
  const t = createConvexTest()
  stubEnv({ INTERNAL_API_KEY: 'secret-token' })

  const response = await t.fetch('/api/profiles', {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Profile A',
      session_id: 'session-1',
      cookies_json: '{"cookies":[{"name":"sessionid","value":"cookie-1","domain":".instagram.com","path":"/"}]}',
      daily_scraping_limit: 25,
      test_ip: true,
      proxy_type: 'http',
    }),
  })
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(body).toMatchObject({
    name: 'Profile A',
    session_id: 'session-1',
    cookies_json: '{"cookies":[{"name":"sessionid","value":"cookie-1","domain":".instagram.com","path":"/"}]}',
    daily_scraping_limit: 25,
    daily_scraping_used: 0,
    test_ip: true,
    proxy_type: 'http',
  })
})

test('omits cookies from list responses but includes them on profile detail responses', async () => {
  const t = createConvexTest()
  const profile = await seedProfile(t, {
    name: 'Profile Cookies',
    cookiesJson: '[{"name":"sessionid","value":"cookie-1","domain":".instagram.com","path":"/"}]',
  })
  stubEnv({ INTERNAL_API_KEY: 'secret-token' })

  const listResponse = await t.fetch('/api/profiles', {
    method: 'GET',
    headers: { authorization: 'Bearer secret-token' },
  })
  const listBody = await listResponse.json()

  expect(listResponse.status).toBe(200)
  expect(listBody[0]).not.toHaveProperty('cookies_json')

  const detailResponse = await t.fetch(`/api/profiles/by-id?profileId=${encodeURIComponent(String(profile!._id))}`, {
    method: 'GET',
    headers: { authorization: 'Bearer secret-token' },
  })
  const detailBody = await detailResponse.json()

  expect(detailResponse.status).toBe(200)
  expect(detailBody).toMatchObject({
    profile_id: profile!._id,
    cookies_json: '[{"name":"sessionid","value":"cookie-1","domain":".instagram.com","path":"/"}]',
  })
})

test('returns a route-level validation error when workflow start is missing an id', async () => {
  const t = createConvexTest()
  stubEnv({ INTERNAL_API_KEY: 'secret-token' })

  const response = await t.fetch('/api/workflows/start', {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  })

  expect(response.status).toBe(400)
  await expect(response.json()).resolves.toEqual({ error: 'id is required' })
})

test('maps workflow rows through the http router', async () => {
  const t = createConvexTest()
  await seedWorkflow(t, { name: 'Workflow B', status: 'running' })
  stubEnv({ INTERNAL_API_KEY: 'secret-token' })

  const response = await t.fetch('/api/workflows?status=running', {
    method: 'GET',
    headers: { authorization: 'Bearer secret-token' },
  })
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(body).toHaveLength(1)
  expect(body[0]).toMatchObject({ name: 'Workflow B', status: 'running' })
})
