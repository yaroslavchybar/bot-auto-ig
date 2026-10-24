import { expect, test } from 'vite-plus/test'
import { api } from '../_generated/api'
import { createConvexTest, seedProfile } from '../../tests/convex/helpers'
import { cleanupProfileReferences } from '../profiles/cleanup'

test('analytics combines counts, uses follow cohorts for ranges, and preserves removed profiles', async () => {
  const t = createConvexTest()
  const first = (await seedProfile(t, { name: 'First' }))!
  const second = (await seedProfile(t, { name: 'Second' }))!
  const empty = (await seedProfile(t, { name: 'Empty' }))!
  await t.run(async (ctx) => {
    for (const row of [
      {
        profileId: first._id,
        profileName: first.name,
        date: '2026-10-16',
        followed: 100,
        followedBack: 15,
        pending: 50,
      },
      {
        profileId: second._id,
        profileName: second.name,
        date: '2026-10-22',
        followed: 50,
        followedBack: 10,
        pending: 40,
      },
      {
        profileId: first._id,
        profileName: first.name,
        date: '2026-09-22',
        followed: 10,
        followedBack: 2,
        pending: 0,
      },
      {
        profileId: second._id,
        profileName: second.name,
        date: '2026-09-23',
        followed: 20,
        followedBack: 4,
        pending: 0,
      },
      {
        profileId: first._id,
        profileName: first.name,
        date: '2026-10-23',
        followed: 1000,
        followedBack: 1000,
        pending: 0,
      },
    ])
      await ctx.db.insert('outreachDays', row)
  })
  const week = (await t.query(api.analytics.overview, { date: '2026-10-22', period: '7days' }))
    .outreach
  expect(week.totals).toMatchObject({ followed: 150, followedBack: 25, pending: 90 })
  expect(week.totals.rate).toBeCloseTo(16.66667)
  expect(week.accounts.find((row) => row.profileId === first._id)?.rate).toBe(15)
  expect(week.accounts.find((row) => row.profileId === second._id)?.rate).toBe(20)
  expect(week.accounts.find((row) => row.profileId === empty._id)?.rate).toBeNull()
  expect(
    (await t.query(api.analytics.overview, { date: '2026-10-22', period: 'today' })).outreach.totals
      .followed,
  ).toBe(50)
  expect(
    (await t.query(api.analytics.overview, { date: '2026-10-22', period: '30days' })).outreach
      .totals.followed,
  ).toBe(170)
  expect(
    (await t.query(api.analytics.overview, { date: '2026-10-22', period: 'all' })).outreach.totals
      .followed,
  ).toBe(180)
  await t.run(async (ctx) => {
    await cleanupProfileReferences(ctx, first._id)
    await ctx.db.delete(first._id)
    const mirror = await ctx.db
      .query('scraperProfiles')
      .withIndex('by_profile', (q) => q.eq('profileId', first._id))
      .unique()
    if (mirror) await ctx.db.delete(mirror._id)
  })
  const after = (await t.query(api.analytics.overview, { date: '2026-10-22', period: '7days' }))
    .outreach
  expect(after.totals).toEqual(week.totals)
  expect(after.accounts.find((row) => row.profileId === first._id)).toMatchObject({
    name: 'First',
    removed: true,
  })
})

test('new tracking excludes historical lead rows rather than inventing historical conversions', async () => {
  const t = createConvexTest()
  const profile = (await seedProfile(t))!
  await t.run((ctx) =>
    ctx.db.insert('leads', {
      username: 'old',
      createdAt: 1,
      senderId: profile._id,
      followed: true,
      followDate: 1,
      followBackAt: 2,
      dmSent: true,
    }),
  )
  expect(
    (await t.query(api.analytics.overview, { date: '2026-10-22', period: 'all' })).outreach.totals,
  ).toEqual({ followed: 0, followedBack: 0, pending: 0, rate: null })
})

test('analytics rejects oversized ranges without truncating counts and keeps date filters', async () => {
  const t = createConvexTest()
  const profile = (await seedProfile(t))!
  const row = {
    profileId: profile._id,
    profileName: profile.name,
    followed: 1,
    followedBack: 0,
    pending: 1,
  }
  for (let offset = 0; offset < 10_000; offset += 500)
    await t.run(async (ctx) => {
      for (let i = offset; i < offset + 500; i++)
        await ctx.db.insert('outreachDays', {
          ...row,
          date: new Date(Date.UTC(1990, 0, i + 1)).toISOString().slice(0, 10),
        })
    })
  await t.run((ctx) => ctx.db.insert('outreachDays', { ...row, date: '2026-10-23' }))
  expect(
    (await t.query(api.analytics.overview, { date: '2026-10-22', period: 'all' })).outreach.totals
      .followed,
  ).toBe(10_000)

  await t.run((ctx) => ctx.db.insert('outreachDays', { ...row, date: '2026-10-22' }))
  await expect(
    t.query(api.analytics.overview, { date: '2026-10-22', period: 'all' }),
  ).rejects.toThrow('Follow-back analytics snapshot is too large. Choose a shorter date range.')
  expect(
    (await t.query(api.analytics.overview, { date: '2026-10-22', period: 'today' })).outreach.totals
      .followed,
  ).toBe(1)
})

test('profile cleanup closes pending follows exactly once while keeping conversion history', async () => {
  const t = createConvexTest()
  const profile = (await seedProfile(t))!
  await t.run(async (ctx) => {
    const outreachDayId = await ctx.db.insert('outreachDays', {
      profileId: profile._id,
      profileName: profile.name,
      date: '2026-10-22',
      followed: 3,
      followedBack: 1,
      pending: 2,
    })
    for (let i = 0; i < 3; i++)
      await ctx.db.insert('leads', {
        username: `lead${i}`,
        createdAt: 1,
        senderId: profile._id,
        followed: true,
        followDate: 1,
        dmSent: false,
        outreachDayId,
        ...(i === 0 ? { followBackAt: 2 } : {}),
      })
    await cleanupProfileReferences(ctx, profile._id)
    await cleanupProfileReferences(ctx, profile._id)
    expect(await ctx.db.get(outreachDayId)).toMatchObject({
      followed: 3,
      followedBack: 1,
      pending: 0,
    })
  })
})
