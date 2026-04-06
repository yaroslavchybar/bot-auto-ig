import { expect, test } from 'vitest'

import { api, internal } from '../../convex/_generated/api'
import {
  createConvexTest,
  createUnauthenticatedConvexTest,
  seedProfile,
} from './helpers'

test('profile write paths do not persist negative daily scraping limits', async () => {
  const t = createConvexTest()

  const createdProfile = await t.mutation(api.profiles.mutations.create, {
    name: 'Red Team Negative Limit',
    dailyScrapingLimit: -5,
    assignedAccountsLimit: -6,
  })
  expect(createdProfile?.dailyScrapingLimit).toBe(0)
  expect(createdProfile?.assignedAccountsLimit).toBe(0)

  const existing = await seedProfile(t, {
    name: 'Existing Profile',
    dailyScrapingLimit: 2,
  })

  const updatedProfile = await t.mutation(api.profiles.mutations.updateById, {
    profileId: existing!._id,
    name: 'Existing Profile',
    dailyScrapingLimit: -9,
    assignedAccountsLimit: -4,
  })
  expect(updatedProfile?.dailyScrapingLimit).toBe(0)
  expect(updatedProfile?.assignedAccountsLimit).toBe(0)

  const httpT = createUnauthenticatedConvexTest()
  const createdViaHttp = await httpT.mutation(internal.profiles.mutations.createInternal, {
    name: 'HTTP Profile',
    dailyScrapingLimit: -7,
    assignedAccountsLimit: -3,
  })
  expect(createdViaHttp?.dailyScrapingLimit).toBe(0)
  expect(createdViaHttp?.assignedAccountsLimit).toBe(0)

  const updatedViaHttp = await httpT.mutation(internal.profiles.mutations.updateByNameInternal, {
    oldName: 'HTTP Profile',
    name: 'HTTP Profile',
    dailyScrapingLimit: -3,
    assignedAccountsLimit: -11,
  })
  expect(updatedViaHttp?.dailyScrapingLimit).toBe(0)
  expect(updatedViaHttp?.assignedAccountsLimit).toBe(0)
})
