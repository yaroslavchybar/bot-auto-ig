import { expect, test, vi } from 'vite-plus/test'
import { internal } from '../_generated/api'
import { defaultRoutine } from '../routinePolicy'
import { createConvexTest, seedModel, seedProfile } from '../../tests/convex/helpers'

for (const deletion of ['id', 'name'] as const) {
  test(`profile deletion by ${deletion} removes all owned state and preserves other profiles`, async () => {
    const t = createConvexTest()
    const profile = (await seedProfile(t, { name: 'Delete' }))!
    const other = (await seedProfile(t, { name: 'Keep' }))!
    const model = (await seedModel(t))!
    const rows = await t.run(async (ctx) => {
      const result = []
      for (const p of [profile, other]) {
        const id = p._id
        const ids = [
          await ctx.db.insert('accountProgress', {
            profileId: id,

            activeDays: 4,
            outreachUsedToday: 0,
            outreachAllowanceToday: 0,
            nextRunAt: 0,
            updatedAt: 1, }),
          await ctx.db.insert('warmupStates', {
            profileId: id,
            day: 4,
            date: '',
            runsToday: 1,
            todayMinutes: 20,
            activeRun: { id: 'run', minutes: 5, restMinutes: 10 }, }),
          await ctx.db.insert('modelSetupStates', {
            profileId: id,
            modelId: model._id,
            startedAt: 1,
            postSourceIds: [],
            postDates: [], }),
          await ctx.db.insert('modelSetupStates', {
            profileId: id,
            modelId: model._id,
            startedAt: 2,
            postSourceIds: [],
            postDates: [], }),
          await ctx.db.insert('scraperRequestUsage', { profileId: id, requests: [] }),
          await ctx.db.insert('proxyProfileAssignments', {
            profileId: id,
            name: p.name,
            proxy: '127.0.0.1:8080',
            proxyType: 'http', }),
        ]
        const worker = await ctx.db
          .query('scraperProfiles')
          .withIndex('by_profile', (q) => q.eq('profileId', id))
          .unique()
        result.push([...ids, worker!._id])
      }
      return result
    })
    const automationId = await t.run(async (ctx) =>
      ctx.db.insert('automations', {
        name: 'Automation',
        createdAt: 1,
        updatedAt: 1,
        routine: {
          ...defaultRoutine,
          outreachEnabled: true,
          outreach: {
              leadListId: await ctx.db.insert('leadLists', {
                name: 'Leads',
                createdAt: 1, }),
              profileIds: [profile._id, other._id],
              message: 'Hi', }, },
      }),
    )
    const remove = () =>
      deletion === 'id'
        ? t.mutation(internal.profiles.mutations.removeByIdInternal, { profileId: profile._id })
        : t.mutation(internal.profiles.mutations.removeByNameInternal, { name: profile.name })
    await expect(remove()).rejects.toThrow(/Begin profile deletion/)
    await t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: profile.name })
    expect(await t.run((ctx) => ctx.db.get(rows[0]![0]!))).not.toBeNull()
    await remove()
    await remove()
    for (const id of rows[0]!) expect(await t.run((ctx) => ctx.db.get(id))).toBeNull()
    for (const id of rows[1]!) expect(await t.run((ctx) => ctx.db.get(id))).not.toBeNull()
    const saved = await t.run((ctx) => ctx.db.get(automationId))
    expect(saved?.routine?.outreach?.profileIds).toEqual([other._id])
    expect(saved?.routine?.outreachEnabled).toBe(true)
    expect(await t.run((ctx) => ctx.db.get(model._id))).not.toBeNull()
    expect(await t.run((ctx) => ctx.db.get(profile._id))).toBeNull()
  })
}

test('deletion clears lead leases and scraper ownership without losing shared data or outreach history', async () => {
  const t = createConvexTest()
  const profile = (await seedProfile(t))!
  const other = (await seedProfile(t, { name: 'Other' }))!
  const ids = await t.run(async (ctx) => {
    const list = await ctx.db.insert('leadLists', { name: 'Leads', createdAt: 1 })
    const leads = []
    for (const [index, senderId] of [profile._id, profile._id, other._id].entries()) {
      const followed = index !== 1
      const leadId = await ctx.db.insert('leads', {
        username: `lead${index}`,
        senderId,
        createdAt: 1,
        dmSent: index === 0,
        followed,
        ...(followed ? { followDate: 1 } : {}),
        outreachListId: list,
        dmEligible: true,
        followBackAt: Date.now(),
        postEngagement: { kind: 'like', at: Date.now() },
        lastDmCheckDate: '2026-10-16',
        classification: 'male',
        screeningStatus: 'ready', })
      const membership = await ctx.db.insert('leadMemberships', {
        leadId,
        listId: list,
        available: false,
        classification: 'male',
        leadCreatedAt: 1, })
      leads.push({ leadId, membership })
    }
    const screening = await ctx.db.insert('leads', {
      username: 'screening',
      createdAt: 1,
      dmSent: false,
      followed: false,
      screeningProfileId: profile._id,
      screeningToken: 'old-token',
      screeningListId: list,
      screeningUntil: Date.now() + 60_000, })
    const source = await ctx.db.insert('scrapeSources', {
      username: 'source',
      listId: list,
      enabled: true,
      running: true,
      profileId: profile._id,
      runId: 'old-run',
      leaseUntil: Date.now() + 60_000,
      runKind: 'posts',
      nextCheckAt: 0,
      postCount: 1,
      leadsAdded: 0,
      createdAt: 1, })
    const post = await ctx.db.insert('scrapePosts', {
      sourceId: source,
      mediaId: '1',
      code: 'abc',
      takenAt: 1,
      scheduled: true,
      monitoring: false,
      nextCheckAt: 0, })
    await ctx.db.insert('leadStats', {
      counts: { total: 4, assigned: 3, male: 3, },
      dataRevision: 0,
      backfillRevision: 0,
      backfillComplete: true,
      backfillCursor: null, })
    return { leads, screening, source, post, list }
  })
  const automationId = await t.run((ctx) =>
    ctx.db.insert('automations', {
      name: 'Automation',
      createdAt: 1,
      updatedAt: 1,
      routine: {
        ...defaultRoutine,
        outreachEnabled: true,
        outreach: { leadListId: ids.list, profileIds: [profile._id], message: 'Hi' }, }, }),
  )
  await t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: profile.name })
  await t.mutation(internal.profiles.mutations.removeByIdInternal, { profileId: profile._id })
  const read = await t.run(async (ctx) => ({
    leads: await Promise.all(ids.leads.map(({ leadId }) => ctx.db.get(leadId))),
    memberships: await Promise.all(ids.leads.map(({ membership }) => ctx.db.get(membership))),
    screening: await ctx.db.get(ids.screening),
    source: await ctx.db.get(ids.source),
    post: await ctx.db.get(ids.post),
    stats: await ctx.db.query('leadStats').unique(),
    automation: await ctx.db.get(automationId), }))
  expect(read.leads[0]).toMatchObject({ followed: true, dmSent: true, followDate: 1 })
  expect(read.leads[0]).not.toHaveProperty('senderId')
  expect(read.leads[0]).not.toHaveProperty('dmEligible')
  expect(read.leads[0]).not.toHaveProperty('followBackAt')
  expect(read.leads[0]).not.toHaveProperty('postEngagement')
  expect(read.memberships.map((row) => row?.available)).toEqual([false, true, false])
  expect(read.leads[2]?.senderId).toBe(other._id)
  expect(read.screening).not.toHaveProperty('screeningProfileId')
  expect(read.screening).not.toHaveProperty('screeningToken')
  expect(read.screening).not.toHaveProperty('screeningUntil')
  expect(read.source).toMatchObject({ running: false, enabled: true, postCount: 1 })
  for (const key of ['profileId', 'runId', 'leaseUntil', 'kind', 'currentPostId'])
    expect(read.source).not.toHaveProperty(key)
  expect(read.post).not.toBeNull()
  expect(read.stats?.counts).toMatchObject({ assigned: 1, total: 4 })
  expect(read.automation?.routine?.outreachEnabled).toBe(false)
  expect(read.automation?.routine).not.toHaveProperty('outreach')
})

test('large lead cleanup continues in batches and rejects cleanup for a live profile', async () => {
  vi.useFakeTimers()
  const t = createConvexTest()
  const profile = (await seedProfile(t))!
  await expect(
    t.mutation(internal.profiles.mutations.cleanupDeletedProfileReferencesInternal, {
      profileId: profile._id, }),
  ).rejects.toThrow(/still exists/)
  const lateLeadId = await t.run(async (ctx) => {
    let last
    for (let i = 0; i < 105; i++) {
      last = await ctx.db.insert('leads', {
        username: `lead${i}`,
        senderId: profile._id,
        screeningProfileId: profile._id,
        screeningToken: `token${i}`,
        dmSent: i < 104,
        followed: false,
        createdAt: 1, })
    }
    return last!
  })
  await t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: profile.name })
  await t.mutation(internal.profiles.mutations.removeByIdInternal, { profileId: profile._id })
  await expect(
    t.mutation(internal.routines.recordFollow, {
      profileId: profile._id,
      leadId: lateLeadId,
      followed: true, }),
  ).rejects.toThrow(/Profile not found/)
  expect(await t.run((ctx) => ctx.db.query('accountProgress').collect())).toEqual([])
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  const leads = await t.run((ctx) => ctx.db.query('leads').collect())
  expect(leads).toHaveLength(105)
  for (const lead of leads) {
    expect(lead).not.toHaveProperty('senderId')
    expect(lead).not.toHaveProperty('screeningProfileId')
    expect(lead).toMatchObject({ dmSent: lead._id !== lateLeadId, followed: false })
  }
})

test('deletion removes login-proxy account references while preserving shared cooldowns', async () => {
  const t = createConvexTest()
  const profile = (await seedProfile(t))!
  const { proxyId, accountId } = await t.run(async (ctx) => {
    const accountId = await ctx.db.insert('igAccounts', {
      profileId: profile._id,
      status: 'assigned',
      usernameHash: 'test',
      ciphertext: 'encrypted',
      createdAt: 1, })
    const proxyId = await ctx.db.insert('proxies', {
      name: 'Login proxy',
      purpose: 'login',
      proxy: '127.0.0.1:8080',
      proxyType: 'http',
      createdAt: 1,
      loginCooldownAccountId: accountId,
      loginCooldownUntil: 999999,
      loginClaim: { accountId, token: 'claim', expiresAt: 999999 }, })
    return { proxyId, accountId }
  })
  await t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: profile.name })
  await t.mutation(internal.profiles.mutations.removeByIdInternal, { profileId: profile._id })
  const proxy = await t.run((ctx) => ctx.db.get(proxyId))
  expect(proxy).toMatchObject({ loginCooldownUntil: 999999 })
  expect(proxy).not.toHaveProperty('loginClaim')
  expect(proxy).not.toHaveProperty('loginCooldownAccountId')
  expect(await t.run((ctx) => ctx.db.get(accountId))).toBeNull()
})

test('retrying deletion by id also removes state left by an already deleted profile', async () => {
  const t = createConvexTest()
  const profile = (await seedProfile(t))!
  const id = await t.run(async (ctx) => {
    await ctx.db.delete(profile._id)
    return ctx.db.insert('warmupStates', {
      profileId: profile._id,
      day: 1,
      date: '',
      runsToday: 0,
      todayMinutes: 10, })
  })
  await t.mutation(internal.profiles.mutations.removeByIdInternal, { profileId: profile._id })
  expect(await t.run((ctx) => ctx.db.get(id))).toBeNull()
})
