import { expect, test } from 'vitest'

import { api, internal } from '../../convex/_generated/api'
import { createConvexTest, seedList, seedProfile } from './helpers'

test('creates profiles and selects available profiles by list with cooldown logic', async () => {
  const t = createConvexTest()
  const list = await seedList(t, 'List A')
  const profile = await seedProfile(t, {
    name: 'Profile A',
    proxy: 'http://proxy',
    cookiesJson: '[{"name":"sessionid","value":"cookie-1","domain":".instagram.com","path":"/"}]',
    sessionId: ' session-1 ',
    dailyScrapingLimit: 10,
  })

  await t.mutation(api.profiles.bulkAddToList, {
    profileIds: [profile!._id],
    listId: list!._id,
  })

  const available = await t.query(api.profiles.getAvailableForLists, {
    listIds: [String(list!._id)],
    cooldownMinutes: 10,
  })

  expect(profile).toMatchObject({
    mode: 'proxy',
    cookiesJson: '[{"name":"sessionid","value":"cookie-1","domain":".instagram.com","path":"/"}]',
    sessionId: 'session-1',
    dailyScrapingLimit: 10,
    dailyScrapingUsed: 0,
  })
  expect(available).toHaveLength(1)
  expect(available[0]?._id).toBe(profile!._id)
})

test('clears busy profiles for lists and resets scraping counters', async () => {
  const t = createConvexTest()
  const list = await seedList(t, 'List A')
  const profile = await seedProfile(t, { name: 'Profile B' })

  await t.mutation(api.profiles.bulkAddToList, {
    profileIds: [profile!._id],
    listId: list!._id,
  })
  await t.mutation(api.profiles.syncStatus, {
    name: 'Profile B',
    status: 'running',
    using: true,
  })
  await t.mutation(api.profiles.incrementDailyScrapingUsed, {
    name: 'Profile B',
    amount: 5,
  })
  await t.mutation(api.profiles.clearBusyForLists, {
    listIds: [list!._id],
  })
  await t.mutation(internal.profiles.resetDailyScrapingUsed, {})

  const updated = await t.query(api.profiles.getById, {
    profileId: profile!._id,
  })

  expect(updated).toMatchObject({
    status: 'idle',
    using: false,
    dailyScrapingUsed: 0,
  })
})

test('updates profile cookies by id and clears them when empty string is provided', async () => {
  const t = createConvexTest()
  const profile = await seedProfile(t, {
    name: 'Profile C',
    cookiesJson: '[{"name":"csrftoken","value":"abc","domain":".instagram.com","path":"/"}]',
  })

  const updated = await t.mutation(api.profiles.updateById, {
    profileId: profile!._id,
    name: 'Profile C',
    cookiesJson: '[{"name":"sessionid","value":"updated","domain":".instagram.com","path":"/"}]',
    dailyScrapingLimit: null,
  })
  expect(updated).toMatchObject({
    cookiesJson: '[{"name":"sessionid","value":"updated","domain":".instagram.com","path":"/"}]',
  })

  const cleared = await t.mutation(api.profiles.updateById, {
    profileId: profile!._id,
    name: 'Profile C',
    cookiesJson: '   ',
    dailyScrapingLimit: null,
  })
  expect(cleared?.cookiesJson).toBeUndefined()
})
