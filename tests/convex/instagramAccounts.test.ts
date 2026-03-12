import { expect, test, vi } from 'vitest'

import { internal } from '../../convex/_generated/api'
import { createConvexTest, insertDoc, seedProfile } from './helpers'

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
