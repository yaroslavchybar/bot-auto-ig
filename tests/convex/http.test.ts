import { expect, test, vi } from 'vitest'

import { api, internal } from '../../convex/_generated/api'
import {
  createConvexTest,
  createUnauthenticatedConvexTest,
  seedList,
  seedProfile,
  seedAutomation,
} from './helpers'

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

test('fails closed when INTERNAL_API_KEY is missing', async () => {
  const t = createConvexTest()
  stubEnv({})

  const response = await t.fetch('/api/lists', { method: 'GET' })

  expect(response.status).toBe(500)
  await expect(response.json()).resolves.toEqual({
    error: 'Internal API key is not configured',
  })
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

test('uses camelCase profile fields across the HTTP boundary', async () => {
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
      sessionId: 'session-1',
      cookiesJson: '{"cookies":[{"name":"sessionid","value":"cookie-1","domain":".instagram.com","path":"/"}]}',
      testIp: true,
      proxyType: 'http',
    }),
  })
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(body).toMatchObject({
    name: 'Profile A',
    sessionId: 'session-1',
    cookiesJson: '{"cookies":[{"name":"sessionid","value":"cookie-1","domain":".instagram.com","path":"/"}]}',
    testIp: true,
    proxyType: 'http',
  })
})

test('updates and syncs profiles over the internal HTTP surface without Clerk identity', async () => {
  const t = createUnauthenticatedConvexTest()
  stubEnv({ INTERNAL_API_KEY: 'secret-token' })

  const created = await t.run(async (ctx) =>
    await ctx.db.insert('profiles', {
      createdAt: Date.now(),
      name: 'Profile Start',
      status: 'idle',
      mode: 'direct',
      using: false,
      testIp: false,
      listIds: [],
      login: false,
    }),
  )

  const updateResponse = await t.fetch('/api/profiles/update-by-name', {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      old_name: 'Profile Start',
      name: 'Profile Start',
      fingerprintOs: 'windows',
    }),
  })
  const syncResponse = await t.fetch('/api/profiles/sync-status', {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Profile Start',
      status: 'running',
      using: true,
    }),
  })
  const updated = await t.run(async (ctx) => await ctx.db.get(created))

  expect(updateResponse.status).toBe(200)
  await expect(updateResponse.json()).resolves.toMatchObject({
    name: 'Profile Start',
    fingerprintOs: 'windows',
  })
  expect(syncResponse.status).toBe(200)
  await expect(syncResponse.json()).resolves.toEqual({ ok: true })
  expect(updated).toMatchObject({
    name: 'Profile Start',
    fingerprintOs: 'windows',
    status: 'running',
    using: true,
  })
  expect(typeof updated?.lastOpenedAt).toBe('number')
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
  expect(listBody[0]).not.toHaveProperty('cookiesJson')

  const detailResponse = await t.fetch(`/api/profiles/by-id?profileId=${encodeURIComponent(String(profile!._id))}`, {
    method: 'GET',
    headers: { authorization: 'Bearer secret-token' },
  })
  const detailBody = await detailResponse.json()

  expect(detailResponse.status).toBe(200)
  expect(detailBody).toMatchObject({
    id: profile!._id,
    cookiesJson: '[{"name":"sessionid","value":"cookie-1","domain":".instagram.com","path":"/"}]',
  })
})

test('returns a route-level validation error when automation start is missing an id', async () => {
  const t = createConvexTest()
  stubEnv({ INTERNAL_API_KEY: 'secret-token' })

  const response = await t.fetch('/api/automations/start', {
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

test('maps automation rows through the http router', async () => {
  const t = createConvexTest()
  await seedAutomation(t, { name: 'Automation B', status: 'running' })
  stubEnv({ INTERNAL_API_KEY: 'secret-token' })

  const response = await t.fetch('/api/automations?status=running', {
    method: 'GET',
    headers: { authorization: 'Bearer secret-token' },
  })
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(body).toHaveLength(1)
  expect(body[0]).toMatchObject({ name: 'Automation B', status: 'running' })
})

test('serves automation routes over INTERNAL_API_KEY without a Clerk identity', async () => {
  const t = createUnauthenticatedConvexTest()
  stubEnv({ INTERNAL_API_KEY: 'secret-token' })

  const automationId = await t.run(async (ctx) =>
    await ctx.db.insert('automations', {
      name: 'Automation Internal Auth',
      description: 'automation auth bridge',
      nodes: [],
      edges: [],
      listIds: [],
      status: 'idle',
      isActive: true,
      retryCount: 0,
      maxRetries: 2,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  )

  const listResponse = await t.fetch('/api/automations?status=idle', {
    method: 'GET',
    headers: { authorization: 'Bearer secret-token' },
  })
  const byIdResponse = await t.fetch(
    `/api/automations/by-id?automationId=${encodeURIComponent(String(automationId))}`,
    {
      method: 'GET',
      headers: { authorization: 'Bearer secret-token' },
    },
  )
  const startResponse = await t.fetch('/api/automations/start', {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ id: automationId }),
  })
  const updateStatusResponse = await t.fetch('/api/automations/update-status', {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ id: automationId, status: 'running' }),
  })

  expect(listResponse.status).toBe(200)
  await expect(listResponse.json()).resolves.toMatchObject([
    { _id: automationId, name: 'Automation Internal Auth', status: 'idle' },
  ])
  expect(byIdResponse.status).toBe(200)
  await expect(byIdResponse.json()).resolves.toMatchObject({
    _id: automationId,
    name: 'Automation Internal Auth',
    status: 'idle',
  })
  expect(startResponse.status).toBe(200)
  await expect(startResponse.json()).resolves.toMatchObject({
    _id: automationId,
    status: 'pending',
  })
  expect(updateStatusResponse.status).toBe(200)
  await expect(updateStatusResponse.json()).resolves.toMatchObject({
    _id: automationId,
    status: 'running',
  })
})
