import { expect, test } from 'vitest'

import { api, internal } from '../../convex/_generated/api'
import { createUnauthenticatedConvexTest } from './helpers'

test('keeps internal HTTP-facing profile queries available without Clerk identity', async () => {
  const t = createUnauthenticatedConvexTest()

  await t.mutation(internal.profiles.mutations.createInternal, {
    name: 'Profile A',
    sessionId: 'session-a',
    cookiesJson:
      '[{"name":"sessionid","value":"cookie-a","domain":".instagram.com","path":"/"}]',
    dailyScrapingLimit: 12,
    assignedAccountsLimit: 5,
  })

  const profiles = await t.query(internal.profiles.queries.listInternal, {})

  expect(profiles).toHaveLength(1)
  expect(profiles[0]).toMatchObject({
    name: 'Profile A',
    sessionId: 'session-a',
    dailyScrapingLimit: 12,
    assignedAccountsLimit: 5,
  })
  await expect(t.query(api.profiles.queries.list, {})).rejects.toThrow('Unauthorized')
})

test('keeps name-based profile maintenance on the internal HTTP surface', async () => {
  const t = createUnauthenticatedConvexTest()

  await t.mutation(internal.profiles.mutations.createInternal, {
    name: 'Profile A',
    proxyType: 'http',
  })

  const updated = await t.mutation(internal.profiles.mutations.updateByNameInternal, {
    oldName: 'Profile A',
    name: 'Profile B',
    proxyType: 'socks5',
    dailyScrapingLimit: 7,
    assignedAccountsLimit: 3,
  })
  const removed = await t.mutation(internal.profiles.mutations.removeByNameInternal, {
    name: 'Profile B',
  })
  const profiles = await t.query(internal.profiles.queries.listInternal, {})

  expect(updated).toMatchObject({
    name: 'Profile B',
    proxyType: 'socks5',
    dailyScrapingLimit: 7,
    assignedAccountsLimit: 3,
  })
  expect(removed).toBe(true)
  expect(profiles).toEqual([])
})

test('normalizes negative scraping limits on the internal HTTP surface', async () => {
  const t = createUnauthenticatedConvexTest()

  const created = await t.mutation(internal.profiles.mutations.createInternal, {
    name: 'Negative HTTP Profile',
    dailyScrapingLimit: -5,
    assignedAccountsLimit: -2,
  })

  const updated = await t.mutation(internal.profiles.mutations.updateByNameInternal, {
    oldName: 'Negative HTTP Profile',
    name: 'Negative HTTP Profile',
    dailyScrapingLimit: -9,
    assignedAccountsLimit: -4,
  })

  expect(created?.dailyScrapingLimit).toBe(0)
  expect(updated?.dailyScrapingLimit).toBe(0)
  expect(created?.assignedAccountsLimit).toBe(0)
  expect(updated?.assignedAccountsLimit).toBe(0)
})

test('keeps list and workflow HTTP-facing queries callable without public auth wrappers', async () => {
  const t = createUnauthenticatedConvexTest()
  const now = Date.now()
  const listId = await t.run((ctx) =>
    ctx.db.insert('lists', {
      name: 'Leads',
      createdAt: now,
    }),
  )
  await t.run((ctx) =>
    ctx.db.insert('workflows', {
      name: 'Workflow A',
      description: 'workflow',
      nodes: [],
      edges: [],
      listIds: [listId],
      status: 'running',
      isActive: false,
      createdAt: now,
      updatedAt: now,
    }),
  )

  const lists = await t.query(internal.lists.listInternal, {})
  const workflows = await t.query(internal.workflows.queries.listInternal, {
    status: 'running',
  })

  expect(lists).toHaveLength(1)
  expect(workflows).toHaveLength(1)
  expect(workflows[0]).toMatchObject({
    name: 'Workflow A',
    status: 'running',
    listIds: [listId],
  })
  await expect(t.query(api.lists.list, {})).rejects.toThrow('Unauthorized')
  await expect(
    t.query(api.workflows.queries.list, {
      status: 'running',
    }),
  ).rejects.toThrow('Unauthorized')
})
