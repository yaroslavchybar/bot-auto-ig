import { expect, test } from 'vitest'

import { api } from '../_generated/api'
import { createConvexTest, insertDoc, seedList } from './helpers'

test('reports dashboard totals and recent profile activity', async () => {
  const t = createConvexTest()
  await seedList(t, 'List A')
  await insertDoc(t, 'profiles', {
    createdAt: Date.now(),
    name: 'Profile A',
    using: false,
    testIp: false,
    login: true,
    mode: 'direct',
    listIds: [],
  })
  await insertDoc(t, 'instagramAccounts', {
    userName: 'user-a',
    createdAt: Date.now(),
    status: 'available',
    message: false,
  })

  const stats = await t.query(api.dashboard.getStats, {})

  expect(stats.totalProfiles).toBe(1)
  expect(stats.activeLists).toBe(1)
  expect(stats.instagramActions).toBe(1)
  expect(stats.recentActivity).toHaveLength(1)
  expect(stats.recentActivity[0]).toMatchObject({
    action: 'Profile Updated',
    details: 'Profile A',
  })
})
