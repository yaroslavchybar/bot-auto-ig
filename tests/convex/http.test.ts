import { expect, test, vi } from 'vitest'

import { api } from '../../convex/_generated/api'
import { internal } from '../../convex/_generated/api'
import {
  createConvexTest,
  createUnauthenticatedConvexTest,
  seedList,
  seedProfile,
  seedWorkflow,
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
      dailyScrapingUsed: 0,
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
      fingerprint_seed: 'seed-123',
      fingerprint_os: 'windows',
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
    fingerprint_seed: 'seed-123',
    fingerprint_os: 'windows',
  })
  expect(syncResponse.status).toBe(200)
  await expect(syncResponse.json()).resolves.toEqual({ ok: true })
  expect(updated).toMatchObject({
    name: 'Profile Start',
    fingerprintSeed: 'seed-123',
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

test('serves workflow routes over INTERNAL_API_KEY without a Clerk identity', async () => {
  const t = createUnauthenticatedConvexTest()
  stubEnv({ INTERNAL_API_KEY: 'secret-token' })

  const workflowId = await t.run(async (ctx) =>
    await ctx.db.insert('workflows', {
      name: 'Workflow Internal Auth',
      description: 'workflow auth bridge',
      nodes: [],
      edges: [],
      listIds: [],
      status: 'idle',
      isActive: false,
      scheduleType: 'instant',
      scheduleConfig: {},
      runsToday: 0,
      retryCount: 0,
      maxRetries: 2,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  )

  const listResponse = await t.fetch('/api/workflows?status=idle', {
    method: 'GET',
    headers: { authorization: 'Bearer secret-token' },
  })
  const byIdResponse = await t.fetch(
    `/api/workflows/by-id?workflowId=${encodeURIComponent(String(workflowId))}`,
    {
      method: 'GET',
      headers: { authorization: 'Bearer secret-token' },
    },
  )
  const startResponse = await t.fetch('/api/workflows/start', {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ id: workflowId }),
  })
  const updateStatusResponse = await t.fetch('/api/workflows/update-status', {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ id: workflowId, status: 'running' }),
  })

  expect(listResponse.status).toBe(200)
  await expect(listResponse.json()).resolves.toMatchObject([
    { _id: workflowId, name: 'Workflow Internal Auth', status: 'idle' },
  ])
  expect(byIdResponse.status).toBe(200)
  await expect(byIdResponse.json()).resolves.toMatchObject({
    _id: workflowId,
    name: 'Workflow Internal Auth',
    status: 'idle',
  })
  expect(startResponse.status).toBe(200)
  await expect(startResponse.json()).resolves.toMatchObject({
    _id: workflowId,
    status: 'pending',
  })
  expect(updateStatusResponse.status).toBe(200)
  await expect(updateStatusResponse.json()).resolves.toMatchObject({
    _id: workflowId,
    status: 'running',
  })
})

test('serves internal keyword routes behind INTERNAL_API_KEY auth', async () => {
  const t = createConvexTest()
  stubEnv({ INTERNAL_API_KEY: 'secret-token' })

  await t.mutation(internal.keywords.upsert, {
    filename: 'names.txt',
    content: 'Alice\nBob',
  })

  const response = await t.fetch('/api/keywords?filename=names.txt', {
    method: 'GET',
    headers: { authorization: 'Bearer secret-token' },
  })

  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toBe('Alice\nBob')
})

test('inserts instagram accounts through the internal HTTP surface', async () => {
  const t = createConvexTest()
  stubEnv({ INTERNAL_API_KEY: 'secret-token' })

  const response = await t.fetch('/api/instagram-accounts/batch', {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      accounts: [
        {
          userName: '@User-A',
          status: 'available',
          message: false,
          createdAt: Date.now(),
        },
      ],
    }),
  })
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(body).toMatchObject({ inserted: 1, skipped: 0 })
})

test('lists and updates scraping tasks through internal-key routes', async () => {
  const t = createConvexTest()
  stubEnv({ INTERNAL_API_KEY: 'secret-token' })

  const task = await t.mutation(api.scrapingTasks.create, {
    name: 'Task A',
    kind: 'followers',
    targetUsername: 'target-a',
  })

  const listResponse = await t.fetch('/api/scraping-tasks', {
    method: 'GET',
    headers: { authorization: 'Bearer secret-token' },
  })
  const byIdResponse = await t.fetch(`/api/scraping-tasks/by-id?id=${encodeURIComponent(String(task!._id))}`, {
    method: 'GET',
    headers: { authorization: 'Bearer secret-token' },
  })
  const setImportedResponse = await t.fetch('/api/scraping-tasks/set-imported', {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      id: task!._id,
      imported: true,
    }),
  })

  expect(listResponse.status).toBe(200)
  await expect(listResponse.json()).resolves.toHaveLength(1)
  expect(byIdResponse.status).toBe(200)
  await expect(byIdResponse.json()).resolves.toMatchObject({ _id: task!._id })
  expect(setImportedResponse.status).toBe(200)
  await expect(setImportedResponse.json()).resolves.toMatchObject({
    _id: task!._id,
    imported: true,
  })
})
