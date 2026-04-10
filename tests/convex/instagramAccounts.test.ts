import { expect, test, vi } from 'vitest'

import { internal } from '../../convex/_generated/api'
import { createConvexTest, insertDoc, seedProfile } from './helpers'

function stubEnv(env: Record<string, string>) {
  vi.stubGlobal('process', { env })
}

test('normalizes usernames and skips duplicates', async () => {
  const t = createConvexTest()

  const first = await t.mutation(internal.instagramAccounts.insert, {
    userName: '@User-A//',
    status: 'available',
    message: false,
    createdAt: Date.now(),
  })
  const second = await t.mutation(internal.instagramAccounts.insert, {
    userName: 'user-a',
    status: 'available',
    message: false,
    createdAt: Date.now(),
  })

  expect(first.alreadyExisted).toBe(false)
  expect(second.alreadyExisted).toBe(true)
})

test('updates assignment state and message flags', async () => {
  const t = createConvexTest()
  const profile = await seedProfile(t, { name: 'Profile A' })
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-12T10:00:00Z'))
  const created = await t.mutation(internal.instagramAccounts.insert, {
    userName: 'user-b',
    status: 'available',
    message: false,
    createdAt: Date.now(),
  })

  const assigned = await t.mutation(internal.instagramAccounts.updateStatus, {
    accountId: created.id,
    status: 'assigned',
    assignedTo: profile!._id,
  })
  const messaged = await t.mutation(internal.instagramAccounts.updateMessage, {
    userName: 'USER-B',
    message: true,
  })
  const profiles = await t.query(internal.instagramAccounts.getProfilesWithAssignedAccounts, {
    status: 'assigned',
  })

  expect(assigned).toMatchObject({
    assignedTo: profile!._id,
    status: 'assigned',
  })
  expect(messaged?.message).toBe(true)
  expect(messaged?.lastMessagedAt).toBe(Date.now())
  expect(profiles).toHaveLength(1)
  expect(profiles[0]?._id).toBe(profile!._id)
})

test('filters message targets by cooldown window', async () => {
  const t = createConvexTest()
  const profile = await seedProfile(t, { name: 'Profile B' })
  const now = Date.UTC(2026, 2, 12, 12, 0, 0)
  vi.useFakeTimers()
  vi.setSystemTime(now)

  await insertDoc(t, 'instagramAccounts', {
    userName: 'eligible-user',
    status: 'assigned',
    assignedTo: profile!._id,
    message: false,
    createdAt: now - 10_000,
    lastMessagedAt: now - 4 * 60 * 60 * 1000,
  })
  await insertDoc(t, 'instagramAccounts', {
    userName: 'cooldown-user',
    status: 'assigned',
    assignedTo: profile!._id,
    message: false,
    createdAt: now - 9_000,
    lastMessagedAt: now - 30 * 60 * 1000,
  })
  await insertDoc(t, 'instagramAccounts', {
    userName: 'never-messaged',
    status: 'assigned',
    assignedTo: profile!._id,
    message: false,
    createdAt: now - 8_000,
  })

  const accounts = await t.query(internal.instagramAccounts.getToMessage, {
    profileId: profile!._id,
    cooldownHours: 2,
  })

  expect(accounts.map((account) => account.userName)).toEqual([
    'eligible-user',
    'never-messaged',
  ])
})

test('lists accounts by status and preserves status updates', async () => {
  const t = createConvexTest()
  const profile = await seedProfile(t, { name: 'Profile C' })
  const now = Date.UTC(2026, 2, 12, 14, 0, 0)
  vi.useFakeTimers()
  vi.setSystemTime(now)

  const created = await t.mutation(internal.instagramAccounts.insert, {
    userName: 'scrape-me',
    status: 'unsubscribed',
    message: false,
    createdAt: now - 5_000,
  })

  await t.mutation(internal.instagramAccounts.updateStatus, {
    accountId: created.id,
    status: 'assigned',
    assignedTo: profile!._id,
  })
  await insertDoc(t, 'instagramAccounts', {
    userName: 'still-unsubscribed',
    status: 'unsubscribed',
    assignedTo: profile!._id,
    message: false,
    createdAt: now - 4_000,
  })

  const assignedAccounts = await t.query(internal.instagramAccounts.listByStatus, {
    status: 'assigned',
  })

  expect(assignedAccounts).toHaveLength(1)
  expect(assignedAccounts[0]).toMatchObject({
    userName: 'scrape-me',
    status: 'assigned',
    assignedTo: profile!._id,
  })
})

test('daily assignment backfills missing profile limits to 10 and tops up to that cap', async () => {
  const t = createConvexTest()
  const now = Date.UTC(2026, 2, 13, 9, 0, 0)
  vi.useFakeTimers()
  vi.setSystemTime(now)

  const listId = await t.run((ctx) =>
    ctx.db.insert('lists', {
      name: 'Assignable',
      createdAt: now,
    }),
  )
  const profileId = await t.run((ctx) =>
    ctx.db.insert('profiles', {
      createdAt: now,
      name: 'Assigned Limit Profile',
      status: 'idle',
      mode: 'direct',
      using: false,
      testIp: false,
      listIds: [listId],
      login: false,
      dailyScrapingUsed: 0,
    } as never),
  )

  await insertDoc(t, 'instagramAccounts', {
    userName: 'assigned-oldest',
    status: 'assigned',
    assignedTo: profileId,
    message: false,
    createdAt: now - 4_000,
  })
  await insertDoc(t, 'instagramAccounts', {
    userName: 'assigned-keep',
    status: 'assigned',
    assignedTo: profileId,
    message: false,
    createdAt: now - 3_000,
  })
  await insertDoc(t, 'instagramAccounts', {
    userName: 'assigned-trim-1',
    status: 'assigned',
    assignedTo: profileId,
    message: false,
    createdAt: now - 2_000,
  })
  await insertDoc(t, 'instagramAccounts', {
    userName: 'assigned-trim-2',
    status: 'assigned',
    assignedTo: profileId,
    message: false,
    createdAt: now - 1_000,
  })
  for (let index = 0; index < 8; index += 1) {
    await insertDoc(t, 'instagramAccounts', {
      userName: `available-${index}`,
      status: 'available',
      message: false,
      createdAt: now + index,
    })
  }

  await t.action(internal.instagramAccounts.assignAvailableAccountsDaily, {})

  const updatedProfile = await t.run((ctx) => ctx.db.get(profileId))
  const allRows = await t.run((ctx) => ctx.db.query('instagramAccounts').collect())
  const assignedRows = allRows
    .filter((row) => String(row.assignedTo || '') === String(profileId) && row.status === 'assigned')
    .sort((a, b) => a.createdAt - b.createdAt)

  expect(updatedProfile?.assignedAccountsLimit).toBe(10)
  expect(assignedRows).toHaveLength(10)
  expect(assignedRows.slice(0, 4).map((row) => row.userName)).toEqual([
    'assigned-oldest',
    'assigned-keep',
    'assigned-trim-1',
    'assigned-trim-2',
  ])
  expect(
    assignedRows.slice(4).every((row) => String(row.userName).startsWith('available-')),
  ).toBe(true)
})

test('daily assignment trims newest assigned accounts first when a profile is over its cap', async () => {
  const t = createConvexTest()
  const now = Date.UTC(2026, 2, 13, 9, 30, 0)
  vi.useFakeTimers()
  vi.setSystemTime(now)

  const listId = await t.run((ctx) =>
    ctx.db.insert('lists', {
      name: 'Overflow',
      createdAt: now,
    }),
  )
  const profileId = await t.run((ctx) =>
    ctx.db.insert('profiles', {
      createdAt: now,
      name: 'Overflow Profile',
      status: 'idle',
      mode: 'direct',
      using: false,
      testIp: false,
      listIds: [listId],
      login: false,
      dailyScrapingUsed: 0,
      assignedAccountsLimit: 2,
    } as never),
  )

  await insertDoc(t, 'instagramAccounts', {
    userName: 'assigned-oldest',
    status: 'assigned',
    assignedTo: profileId,
    message: false,
    createdAt: now - 4_000,
  })
  await insertDoc(t, 'instagramAccounts', {
    userName: 'assigned-keep',
    status: 'assigned',
    assignedTo: profileId,
    message: false,
    createdAt: now - 3_000,
  })
  await insertDoc(t, 'instagramAccounts', {
    userName: 'assigned-trim-1',
    status: 'assigned',
    assignedTo: profileId,
    message: false,
    createdAt: now - 2_000,
  })
  await insertDoc(t, 'instagramAccounts', {
    userName: 'assigned-trim-2',
    status: 'assigned',
    assignedTo: profileId,
    message: false,
    createdAt: now - 1_000,
  })

  await t.action(internal.instagramAccounts.assignAvailableAccountsDaily, {})

  const allRows = await t.run((ctx) => ctx.db.query('instagramAccounts').collect())
  const assignedRows = allRows
    .filter((row) => String(row.assignedTo || '') === String(profileId) && row.status === 'assigned')
    .sort((a, b) => a.createdAt - b.createdAt)
  const trimmedRows = allRows
    .filter((row) => ['assigned-trim-1', 'assigned-trim-2'].includes(String(row.userName)))
    .sort((a, b) => String(a.userName).localeCompare(String(b.userName)))

  expect(assignedRows.map((row) => row.userName)).toEqual([
    'assigned-oldest',
    'assigned-keep',
  ])
  expect(trimmedRows[0]?.status).toBe('available')
  expect(trimmedRows[0]?.assignedTo).toBeUndefined()
  expect(trimmedRows[1]?.status).toBe('available')
  expect(trimmedRows[1]?.assignedTo).toBeUndefined()
})

test('chunks oversized instagram account batches and aggregates duplicate counts', async () => {
  const t = createConvexTest()
  stubEnv({ INTERNAL_API_KEY: 'secret-token' })

  await t.mutation(internal.instagramAccounts.insert, {
    userName: 'existing-user',
    status: 'available',
    message: false,
    createdAt: Date.now() - 1_000,
  })

  const accounts = [
    ...Array.from({ length: 499 }, (_, index) => ({
      userName: `batch-user-${index}`,
      fullName: `Batch User ${index}`,
      matchedName: `Match ${index}`,
      status: 'available',
      message: false,
      createdAt: Date.now() + index,
    })),
    {
      userName: 'cross-boundary',
      fullName: 'Cross Boundary',
      matchedName: 'Cross',
      status: 'available',
      message: false,
      createdAt: Date.now() + 500,
    },
    {
      userName: '@Cross-Boundary//',
      fullName: 'Cross Boundary Duplicate',
      matchedName: 'Cross',
      status: 'available',
      message: false,
      createdAt: Date.now() + 501,
    },
    {
      userName: 'existing-user',
      fullName: 'Existing User',
      matchedName: 'Existing',
      status: 'available',
      message: false,
      createdAt: Date.now() + 502,
    },
    {
      userName: 'tail-user',
      fullName: 'Tail User',
      matchedName: 'Tail',
      status: 'done',
      message: false,
      createdAt: Date.now() + 503,
    },
  ]

  const response = await t.fetch('/api/instagram-accounts/batch', {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ accounts }),
  })
  const body = await response.json()
  const rows = await t.run(async (ctx) => await ctx.db.query('instagramAccounts').collect())
  const crossBoundaryRows = rows.filter((row) => row.userName === 'cross-boundary')
  const tailRow = rows.find((row) => row.userName === 'tail-user')

  expect(response.status).toBe(200)
  expect(body).toMatchObject({ inserted: 501, skipped: 2 })
  expect(Array.isArray(body.ids)).toBe(true)
  expect(body.ids).toHaveLength(501)
  expect(rows).toHaveLength(502)
  expect(crossBoundaryRows).toHaveLength(1)
  expect(tailRow).toMatchObject({
    userName: 'tail-user',
    status: 'done',
    fullName: 'Tail User',
    matchedName: 'Tail',
  })
})

test('reports partial progress when a later instagram account batch fails', async () => {
  const t = createConvexTest()
  stubEnv({ INTERNAL_API_KEY: 'secret-token' })

  const accounts = [
    ...Array.from({ length: 500 }, (_, index) => ({
      userName: `batch-user-${index}`,
      fullName: `Batch User ${index}`,
      matchedName: `Match ${index}`,
      status: 'available',
      message: false,
      createdAt: Date.now() + index,
    })),
    {
      fullName: 'Missing Username',
      matchedName: 'Missing',
      status: 'available',
      message: false,
      createdAt: Date.now() + 501,
    },
  ]

  const response = await t.fetch('/api/instagram-accounts/batch', {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ accounts }),
  })
  const body = await response.json()
  const rows = await t.run(async (ctx) => await ctx.db.query('instagramAccounts').collect())

  expect(response.status).toBe(400)
  expect(body.error).toContain('partial progress inserted=500, skipped=0')
  expect(rows).toHaveLength(500)
})

test('daily assignment respects zero assigned account limits', async () => {
  const t = createConvexTest()
  const now = Date.UTC(2026, 2, 13, 10, 0, 0)
  vi.useFakeTimers()
  vi.setSystemTime(now)

  const listId = await t.run((ctx) =>
    ctx.db.insert('lists', {
      name: 'Zero Limit',
      createdAt: now,
    }),
  )
  const profileId = await t.run((ctx) =>
    ctx.db.insert('profiles', {
      createdAt: now,
      name: 'Zero Limit Profile',
      status: 'idle',
      mode: 'direct',
      using: false,
      testIp: false,
      listIds: [listId],
      login: false,
      dailyScrapingUsed: 0,
      assignedAccountsLimit: 0,
    } as never),
  )

  await insertDoc(t, 'instagramAccounts', {
    userName: 'zero-limit-assigned',
    status: 'assigned',
    assignedTo: profileId,
    message: false,
    createdAt: now - 1_000,
  })
  await insertDoc(t, 'instagramAccounts', {
    userName: 'zero-limit-available',
    status: 'available',
    message: false,
    createdAt: now,
  })

  await t.action(internal.instagramAccounts.assignAvailableAccountsDaily, {})

  const allRows = await t.run((ctx) => ctx.db.query('instagramAccounts').collect())
  const stillAssigned = allRows.filter((row) => String(row.assignedTo || '') === String(profileId))
  const trimmed = allRows.find((row) => row.userName === 'zero-limit-assigned')

  expect(stillAssigned).toHaveLength(0)
  expect(trimmed?.userName).toBe('zero-limit-assigned')
  expect(trimmed?.status).toBe('available')
  expect(trimmed?.assignedTo).toBeUndefined()
})
