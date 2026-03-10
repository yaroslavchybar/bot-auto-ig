import { expect, test } from 'vitest'

import { internal } from '../../convex/_generated/api'
import { createConvexTest, seedProfile } from './helpers'

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
  expect(profiles).toHaveLength(1)
  expect(profiles[0]?._id).toBe(profile!._id)
})
