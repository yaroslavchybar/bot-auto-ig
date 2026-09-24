import { expect, test, vi } from 'vitest'

import { api, internal } from '../../convex/_generated/api'
import { createConvexTest, insertDoc, seedList, seedAutomation } from './helpers'

function stubBridgeKey(key: string) {
  vi.stubGlobal('process', { env: { INTERNAL_API_KEY: key } })
}

test('lists.remove cleans up assignment rows', async () => {
  const t = createConvexTest()
  const list = await seedList(t, 'List A')
  const profile = await insertDoc(t, 'profiles', {
    createdAt: Date.now(),
    name: 'Profile A',
    using: false,
    mode: 'direct',
    listIds: [],
  })

  await t.mutation(api.profiles.mutations.bulkAddToList, {
    profileIds: [profile!._id],
    listId: list!._id,
  })
  const before = await t.run(async (ctx) =>
    ctx.db.query('profileListAssignments').collect(),
  )
  expect(before.length).toBe(1)

  await t.mutation(api.lists.remove, { id: list!._id })

  const after = await t.run(async (ctx) =>
    ctx.db.query('profileListAssignments').collect(),
  )
  expect(after).toEqual([])
})

test('runtimeSnapshot returns timing fields and requires the bridge token', async () => {
  const t = createConvexTest()
  stubBridgeKey('bridge-secret')
  const list = await seedList(t, 'List A')
  const profile = await insertDoc(t, 'profiles', {
    createdAt: Date.now(),
    name: 'Profile A',
    using: false,
    mode: 'direct',
    listIds: [],
  })
  await t.mutation(api.profiles.mutations.bulkAddToList, {
    profileIds: [profile!._id],
    listId: list!._id,
  })
  const automation = await seedAutomation(t, {
    status: 'running',
    isActive: true,
    listIds: [list!._id],
    routine: {
      outreachStartDay: 7,
      initialDms: 3,
      maxDms: 30,
      outreachEnabled: false,
      message: '',
      activity: {},
      headless: true,
    },
  })
  const now = Date.now()
  await t.run(async (ctx) => {
    await ctx.db.insert('warmupStates', {
      profileId: profile!._id,
      day: 1,
      date: '2026-09-21',
      runsToday: 1,
      todayMinutes: 30,
      minutesUsedToday: 10,
      nextRunAt: now + 60_000,
      updatedAt: now,
    })
    await ctx.db.insert('accountProgress', {
      profileId: profile!._id,
      paused: false,
      activeDays: 1,
      outreachDays: 0,
      date: '2026-09-21',
      used: 0,
      allowance: 3,
      nextRunAt: now + 120_000,
      startedAt: now,
      updatedAt: now,
    })
  })

  const snapshot = await t.query(api.automations.queries.runtimeSnapshot, {
    bridgeToken: 'bridge-secret',
    id: automation!._id,
    listIds: [String(list!._id)],
  })
  expect(snapshot?.profiles.length).toBe(1)
  expect(snapshot?.warmups?.[0]?.nextRunAt).toBeGreaterThan(now - 1000)
  expect(snapshot?.progress?.[0]?.nextRunAt).toBeGreaterThan(now - 1000)

  await expect(
    t.query(api.automations.queries.runtimeSnapshot, {
      bridgeToken: 'wrong',
      id: automation!._id,
      listIds: [String(list!._id)],
    }),
  ).rejects.toThrow('Unauthorized')

  const routines = await t.query(
    api.automations.queries.listRoutinesForScheduler,
    { bridgeToken: 'bridge-secret' },
  )
  expect(routines.length).toBe(1)
})

test('runtimeSnapshot stays bounded and list pages sweep every assignment', async () => {
  const t = createConvexTest()
  stubBridgeKey('bridge-secret')
  const list = await seedList(t, 'List Paged')
  for (let i = 0; i < 3; i++) {
    const profile = await insertDoc(t, 'profiles', {
      createdAt: Date.now() + i,
      name: `Paged ${i}`,
      using: false,
      mode: 'direct',
      listIds: [],
    })
    await t.mutation(api.profiles.mutations.bulkAddToList, {
      profileIds: [profile!._id],
      listId: list!._id,
    })
  }
  const automation = await seedAutomation(t, {
    status: 'running',
    isActive: true,
    listIds: [list!._id],
    routine: {
      outreachStartDay: 7,
      initialDms: 3,
      maxDms: 30,
      outreachEnabled: false,
      message: '',
      activity: {},
      headless: true,
    },
  })

  const first = await t.query(api.automations.queries.runtimeSnapshot, {
    bridgeToken: 'bridge-secret',
    id: automation!._id,
    listIds: [String(list!._id)],
  })
  expect(first?.profiles.length).toBe(3)
  expect(first?.truncated).toBe(false)

  // Keyset page over the single list index covers the same set in one bounded read.
  const page = await t.query(internal.automations.queries.runtimeListPageInternal, {
    id: automation!._id,
    listId: String(list!._id),
  })
  expect(page?.profiles.length).toBe(3)
  expect(page?.isDone).toBe(true)
  expect(page?.nextCursor).toBe(null)
  expect(new Set(page?.profiles.map((p: any) => String(p.id))).size).toBe(3)

  // Non-routine automations cannot be paired with an unrelated list.
  const classic = await seedAutomation(t, { status: 'running', isActive: true })
  const rejected = await t.query(internal.automations.queries.runtimeListPageInternal, {
    id: classic!._id,
    listId: String(list!._id),
  })
  expect(rejected).toBe(null)
})
