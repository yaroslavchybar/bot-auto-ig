import { afterEach, expect, test, vi } from 'vite-plus/test'
import { api, internal } from '../_generated/api'
import { defaultRoutine, dayKey } from '../routinePolicy'
import { createConvexTest, seedModel, seedProfile } from '../../tests/convex/helpers'
import { patchProfile } from '../workerMetadata'

afterEach(() => vi.useRealTimers())
async function setup() {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))
  const t = createConvexTest(),
    model = (await seedModel(t))!,
    profile = (await seedProfile(t))!
  const listId = await t.mutation(api.leads.createList, { name: 'Recipients' })
  await t.mutation(api.profiles.mutations.bulkAddToModel, {
    profileIds: [profile._id],
    modelId: model._id,
  })
  const automation = (await t.mutation(api.automations.mutations.create, {
    name: 'Outreach',
    modelIds: [model._id],
    routine: { ...defaultRoutine, outreachEnabled: true, outreach: { leadListId: listId, profileIds: [], allProfiles: true, message: 'Hello' },  },
  }))!
  await t.mutation(api.automations.mutations.setActive, { id: automation._id, isActive: true })
  const args = { automationId: automation._id, profileId: profile._id }
  const { warmupId, ids } = await t.run(async (ctx) => {
    await ctx.db.insert('proxies', {
      name: 'Owner proxy',
      proxy: 'owner.test:8000',
      proxyType: 'http',
      country: 'ua',
      createdAt: 1,
    })
    await patchProfile(ctx, profile._id, {
      inUse: true,
      igLoggedIn: true,
      outreachReady: true,
      proxy: 'owner.test:8000',
      proxyType: 'http',
      cookiesJson: JSON.stringify([{ name: 'ds_user_id', value: '123' }]),
    })
    const warmupId = await ctx.db.insert('warmupStates', {
      profileId: profile._id,
      day: 8,
      date: dayKey(),
      runsToday: 1,
      todayMinutes: 30,
      activeRun: { id: 'run', minutes: 30, restMinutes: 10 },
    })
    const ids = []
    for (const [index, username] of ['old', 'new', 'stranger'].entries()) {
      ids.push(
        await ctx.db.insert('leads', {
          igId: String(index + 1),
          username,
          classification: 'male',
          createdAt: 1,
          dmSent: false,
          followed: username !== 'stranger',
          followDate: Date.now() - 86_400_000,
          senderId: profile._id,
          outreachAutomationId: automation._id,
          outreachListId: listId,
        }),
      )
    }
    return { warmupId, ids }
  })
  const save = (likers: { igId: string; username: string }[], mediaId = '456', extra = {}) =>
    t.mutation(internal.ownPostLikers.snapshot, {
      ...args,
      runId: 'run',
      date: dayKey(),
      ownerIgId: '123',
      mediaId,
      likers,
      ...extra,
    })
  const nextDay = () => vi.setSystemTime(Date.now() + 86_400_000)
  return { t, args, profile, automation, warmupId, ids, save, nextDay }
}

test('first snapshot is a baseline; only newly observed followed leads enter the existing one-DM queue', async () => {
  const s = await setup(),
    old = { igId: '1', username: 'old' },
    fresh = { igId: '2', username: 'new' }
  expect(await s.save([old])).toEqual({ saved: true, queued: 0 })
  expect(await s.t.query(internal.routines.dmTasks, s.args)).toEqual([])
  expect(await s.save([fresh])).toEqual({ saved: true, queued: 0 }) // A retry cannot replace today's snapshot.
  s.nextDay()
  expect(await s.save([old, fresh, { igId: '3', username: 'stranger' }])).toEqual({
    saved: true,
    queued: 1,
  })
  const [task] = await s.t.query(internal.routines.dmTasks, s.args)
  expect(task).toMatchObject({ leadId: s.ids[1], engagement: 'like' })
  const input = { ...s.args, leadId: task.leadId, date: dayKey() }
  expect(await s.t.mutation(internal.routines.beginSend, input)).toBe(true)
  expect(await s.t.mutation(internal.routines.beginSend, input)).toBe(false)
  await s.t.mutation(internal.routines.finishSend, {
    profileId: s.profile._id,
    leadId: task.leadId,
    date: dayKey(),
    sent: true,
  })
  s.nextDay()
  expect(await s.save([])).toMatchObject({ saved: true, queued: 0 })
  s.nextDay()
  expect(await s.save([fresh])).toMatchObject({ saved: true, queued: 0 })
  expect(await s.t.query(internal.routines.dmTasks, s.args)).toEqual([])
})

test('snapshots and completion are bound to the owner and active browser run', async () => {
  const s = await setup(),
    rows = [{ igId: '1', username: 'old' }]
  expect(await s.save(rows, '456', { ownerIgId: 'someone-else' })).toMatchObject({ saved: false })
  expect(await s.save(rows, '456', { runId: 'stale' })).toMatchObject({ saved: false })
  await s.save(rows)
  expect(await s.t.query(internal.ownPostLikers.plan, s.args)).toMatchObject({
    ownerIgId: '123',
    checkedMediaIds: ['456'],
  })
  expect(
    await s.t.mutation(internal.ownPostLikers.finish, {
      ...s.args,
      date: dayKey(),
      runId: 'stale',
    }),
  ).toBe(false)
  expect(
    await s.t.mutation(internal.ownPostLikers.finish, { ...s.args, date: dayKey(), runId: 'run' }),
  ).toBe(true)
  expect(await s.t.query(internal.ownPostLikers.plan, s.args)).toBeNull()
  s.nextDay()
  await s.t.run((ctx) => ctx.db.patch(s.warmupId, { activeRun: undefined }))
  expect(await s.t.query(internal.ownPostLikers.plan, s.args)).toBeNull()
})

test('another sender and conflicting Instagram IDs cannot qualify; switching owners starts a new baseline', async () => {
  const s = await setup()
  await s.save([])
  s.nextDay()
  await s.t.run(async (ctx) => {
    await ctx.db.patch(s.ids[0], { senderId: undefined })
  })
  expect(
    await s.save([
      { igId: '1', username: 'old' },
      { igId: '999', username: 'new' },
    ]),
  ).toMatchObject({ queued: 0 })
  expect(await s.t.query(internal.routines.dmTasks, s.args)).toEqual([])
  s.nextDay()
  await s.t.run((ctx) =>
    ctx.db.patch(s.profile._id, {
      cookiesJson: JSON.stringify([{ name: 'ds_user_id', value: '456' }]),
    }),
  )
  expect(await s.save([{ igId: '2', username: 'new' }], '456', { ownerIgId: '456' })).toEqual({
    saved: true,
    queued: 0,
  })
  expect(await s.t.query(internal.routines.dmTasks, s.args)).toEqual([])
})

test('own-post liker work follows the DM switch independently of new following', async () => {
  const s = await setup();
  await s.t.run(ctx => ctx.db.patch(s.automation._id, {
    routine: { ...s.automation.routine!, followingEnabled: false, notificationDmsEnabled: false },
  }));
  expect(await s.t.query(internal.ownPostLikers.plan, s.args)).toBeNull();
  expect((await s.t.mutation(internal.ownPostLikers.reserve, { ...s.args, requestId: 'disabled', runId: 'run' })).allowed).toBe(false);
  expect(await s.save([{ igId: '2', username: 'new' }])).toEqual({ saved: false, queued: 0 });
  expect(await s.t.mutation(internal.ownPostLikers.finish, { ...s.args, runId: 'run', date: dayKey() })).toBe(false);
  expect(await s.t.run(ctx => ctx.db.query('ownPostLikerSnapshots').collect())).toEqual([]);
  await s.t.run(ctx => ctx.db.patch(s.automation._id, {
    routine: { ...s.automation.routine!, followingEnabled: false, notificationDmsEnabled: true },
  }));
  expect(await s.t.query(internal.ownPostLikers.plan, s.args)).toMatchObject({ runId: 'run' });
});

test('the owner shares request limits, while other scrapers remain blocked during its browser session', async () => {
  const s = await setup()
  expect(
    (
      await s.t.mutation(internal.scraperRequests.reserve, {
        profileId: s.profile._id,
        requestId: 'ordinary',
      })
    ).allowed,
  ).toBe(false)
  const reserve = (requestId: string, runId = 'run') =>
    s.t.mutation(internal.ownPostLikers.reserve, { ...s.args, requestId, runId })
  expect((await reserve('bad', 'stale')).allowed).toBe(false)
  for (let i = 0; i < 10; i++) expect((await reserve(String(i))).allowed).toBe(true)
  expect((await reserve('0')).allowed).toBe(true)
  expect((await reserve('over-limit')).allowed).toBe(false)
  await s.t.run((ctx) => ctx.db.patch(s.profile._id, { scraperCooldownUntil: Date.now() + 60_000 }))
  expect((await reserve('cooldown')).allowed).toBe(false)
})

test('the 100-ID cap and sender/history checks also apply to snapshot-based DMs', async () => {
  const s = await setup()
  await expect(
    s.save(Array.from({ length: 101 }, (_, n) => ({ igId: String(n + 1), username: `user${n}` }))),
  ).rejects.toThrow('Invalid own-post')
  await s.save([])
  s.nextDay()
  await s.t.run(async (ctx) => {
    await ctx.db.patch(s.ids[0], { unfollowAt: Date.now() })
    await ctx.db.patch(s.ids[1], { dmStartedAt: Date.now() })
  })
  expect(
    await s.save([
      { igId: '1', username: 'old' },
      { igId: '2', username: 'new' },
    ]),
  ).toMatchObject({ saved: true, queued: 0 })
  await s.t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: s.profile.name })
  await s.t.mutation(internal.profiles.mutations.removeByIdInternal, { profileId: s.profile._id })
  expect(await s.t.run((ctx) => ctx.db.query('ownPostLikerSnapshots').collect())).toEqual([])
})
