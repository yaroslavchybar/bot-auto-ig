import { expect, test } from 'vitest'

import { api, internal } from '../../convex/_generated/api'
import { createUnauthenticatedConvexTest } from './helpers'

test('keeps internal HTTP-facing profile queries available without identity', async () => {
  const t = createUnauthenticatedConvexTest()

  await t.mutation(internal.profiles.mutations.createInternal, {
    name: 'Profile A',
    cookiesJson:
      '[{"name":"sessionid","value":"cookie-a","domain":".instagram.com","path":"/"}]',
  })

  const profiles = await t.query(internal.profiles.queries.listInternal, {})

  expect(profiles).toHaveLength(1)
  expect(profiles[0]).toMatchObject({
    name: 'Profile A',
  })
  await expect(t.query(api.profiles.queries.list, {})).resolves.toHaveLength(1)
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
    proxy: 'host:1080',
    proxyType: 'socks5',
  })
  await t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: 'Profile B' })
  const removed = await t.mutation(internal.profiles.mutations.removeByNameInternal, {
    name: 'Profile B',
  })
  const profiles = await t.query(internal.profiles.queries.listInternal, {})

  expect(updated).toMatchObject({
    name: 'Profile B',
    proxyType: 'socks5',
  })
  expect(removed).toBe(true)
  expect(profiles).toEqual([])
})

test('keeps list and automation HTTP-facing queries callable without public auth wrappers', async () => {
  const t = createUnauthenticatedConvexTest()
  const now = Date.now()
  const listId = await t.run((ctx) =>
    ctx.db.insert('lists', {
      name: 'Leads',
      createdAt: now,
    }),
  )
  await t.run((ctx) =>
    ctx.db.insert('automations', {
      name: 'Automation A',
      description: 'automation',
      nodes: [],
      edges: [],
      listIds: [listId],
      status: 'running',
      isActive: false,
      createdAt: now,
      updatedAt: now,
    }),
  )

  const lists = await t.query(api.lists.list, {})
  const automations = await t.query(internal.automations.queries.listInternal, {
    status: 'running',
  })

  expect(lists).toHaveLength(1)
  expect(automations).toHaveLength(1)
  expect(automations[0]).toMatchObject({
    name: 'Automation A',
    status: 'running',
    listIds: [listId],
  })
  await expect(t.query(api.lists.list, {})).resolves.toHaveLength(1)
  await expect(
    t.query(api.automations.queries.list, {
      status: 'running',
    }),
  ).resolves.toHaveLength(1)
})
