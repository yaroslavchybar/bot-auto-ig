import { expect, test, vi, afterEach } from 'vite-plus/test'
import { api, internal } from '../../convex/_generated/api'
import { advanceTestClock, createConvexTest, seedProfile, seedModel, seedAutomation } from './helpers'
import { defaultRoutine } from '../../convex/routinePolicy'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
async function setup(options: { sessionMinMinutes?: number; sessionMaxMinutes?: number; restMinMinutes?: number; restMaxMinutes?: number } = {}) {
  const t = createConvexTest()
  const profile = await seedProfile(t)
  const args = { profileId: profile!._id, automationId: 'automation', runId: 'one', minMinutes: 40, maxMinutes: 40,
    sessionMinMinutes: 40, sessionMaxMinutes: 40, restMinMinutes: 0, restMaxMinutes: 0, ...options }
  const begin = (runId = 'one') => t.mutation(internal.warmup.mutations.beginRunInternal, { ...args, runId })
  const finish = (date: string, minutes: number, runId = 'one') =>
    t.mutation(internal.warmup.mutations.finishRunInternal, { profileId: args.profileId, date, minutes, runId })
  const state = () => t.query(api.warmup.queries.getByProfile, { profileId: args.profileId })
  return { t, args, begin, finish, state }
}

test('assigns one budget, retries the reservation, and blocks competing runs', async () => {
  const { begin, state } = await setup()
  const plan = await begin()
  expect(plan.minutes).toBe(40)
  expect(await begin()).toEqual(plan)
  expect((await begin('competing')).minutes).toBe(0)
  expect(await state()).toMatchObject({ day: 1, todayMinutes: 40, minutesUsedToday: 0, runsToday: 0 })
})

test.each([
  ['ua', 'Europe/Kyiv'], ['US', 'America/New_York'], ['zz', undefined], [undefined, undefined],
])('session appearance timezone comes from its assigned proxy country (%s)', async (country, timezone) => {
  const { t, args, begin } = await setup()
  await t.run(async ctx => {
    const proxy = 'http://proxy.example:8080'
    await ctx.db.insert('proxies', { name: 'Work proxy', proxy, proxyType: 'http', country, createdAt: Date.now() })
    await ctx.db.insert('proxies', { name: 'Other proxy', proxy: 'http://other.example:8080', proxyType: 'http', country: 'jp', createdAt: Date.now() })
    await ctx.db.patch(args.profileId, { proxy, proxyType: 'http' })
  })
  const plan = await begin()
  expect('timezone' in plan ? plan.timezone : undefined).toBe(timezone)
  expect(await begin()).toEqual(plan)
})

test('day one reserves only browsing and preserves the plan across retries', async () => {
  const { t, args } = await setup()
  const input = args
  const plan = await t.mutation(internal.warmup.mutations.beginRunInternal, input)
  expect(plan.activityPlan).toMatchObject({ likes: 0 })
  expect(plan.activityPlan?.stories).toBe(0)
  expect(await t.mutation(internal.warmup.mutations.beginRunInternal, input)).toEqual(plan)
})

test('week-one follows have an independent quota and count once without analytics initialization', async () => {
  const { t, args, begin } = await setup()
  const listId = (await seedModel(t))!._id
  const automation = await seedAutomation(t, { modelIds: [listId], routine: { ...defaultRoutine, outreachEnabled: false } })
  await t.run(ctx => ctx.db.patch(args.profileId, { modelId: listId, igLoggedIn: true }))
  const plan = await begin()
  await t.run(async ctx => {
    const state = await ctx.db.query('warmupStates').unique()
    await ctx.db.patch(state!._id, { day: 3, lastAutomationId: automation!._id,
      activityPlan: { ...plan.activityPlan!, follows: 2 } })
  })
  const follow = { profileId: args.profileId, runId: args.runId, date: plan.date, username: 'fitness_one' }
  expect(await t.mutation(internal.warmup.mutations.beginFollowInternal, { ...follow, runId: 'wrong' })).toBe(false)
  expect(await t.mutation(internal.warmup.mutations.beginFollowInternal, follow)).toBe(true)
  expect(await t.mutation(internal.warmup.mutations.beginFollowInternal, follow)).toBe(false)
  await t.mutation(internal.warmup.mutations.confirmFollowInternal, follow)
  await t.mutation(internal.warmup.mutations.confirmFollowInternal, follow)
  expect(await t.mutation(internal.warmup.mutations.beginFollowInternal, { ...follow, username: 'fitness_two' })).toBe(true)
  expect(await t.mutation(internal.warmup.mutations.beginFollowInternal, { ...follow, username: 'fitness_three' })).toBe(false)
  await t.mutation(internal.warmup.mutations.finishRunInternal, { profileId: args.profileId, runId: args.runId,
    date: plan.date, minutes: 5, activity: { likes: 0, follows: 2, profiles: 0, reels: 0, stories: 0 } })
  expect((await begin('two')).activityUsed?.follows).toBe(2)
  expect((await t.run(ctx => ctx.db.query('analyticsHistory').unique()))?.totals.follows).toBe(1)
  expect(await t.run(ctx => ctx.db.query('leads').collect())).toEqual([])
})

test.each([1, 2, 8])('warm-up follow authorization is blocked outside days 3–7 (day %s)', async day => {
  const { t, args, begin } = await setup()
  const plan = await begin()
  await t.run(async ctx => {
    const state = await ctx.db.query('warmupStates').unique()
    await ctx.db.patch(state!._id, { day, activityPlan: { ...plan.activityPlan!, follows: 10 } })
  })
  expect(await t.mutation(internal.warmup.mutations.beginFollowInternal,
    { profileId: args.profileId, runId: args.runId, date: plan.date, username: 'fitness' })).toBe(false)
})

test('pre-ramp plans receive the current day limits without resetting the reservation', async () => {
  const { t, args, begin } = await setup()
  const first = await begin()
  await t.run(async ctx => {
    const state = await ctx.db.query('warmupStates').withIndex('by_profile', q => q.eq('profileId', args.profileId)).unique()
    await ctx.db.patch(state!._id, { activityPlan: { likes: 6, profiles: first.activityPlan!.profiles,
      reels: first.activityPlan!.reels, stories: first.activityPlan!.stories },
      activityUsed: { likes: 2, profiles: 1, reels: 3, stories: 0 } })
  })
  const retry = await begin()
  expect(retry.minutes).toBe(first.minutes)
  expect(retry.activityPlan?.likes).toBe(0)
  expect(retry.activityPlan?.follows).toBe(0)
  expect(retry.activityUsed).toEqual({ likes: 0, profiles: 1, reels: 3, stories: 0, follows: 0, saves: 0, comments: 0 })
  expect((await begin('competing')).minutes).toBe(0)
})

test('daily activity plan persists across sessions and finish retries without extra usage', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))
  const { t, args, begin } = await setup({ sessionMinMinutes: 5, sessionMaxMinutes: 5 })
  const first = await begin()
  expect(first.activityPlan?.likes).toBe(0)
  const finish = { profileId: args.profileId, runId: 'one', date: first.date, minutes: 5,
    activity: { likes: 0, profiles: 1, reels: 3, stories: 0, follows: 0, saves: 0, comments: 0 } }
  await t.mutation(internal.warmup.mutations.finishRunInternal, finish)
  await t.mutation(internal.warmup.mutations.finishRunInternal, finish)
  const second = await begin('two')
  expect(second.activityPlan).toEqual(first.activityPlan)
  expect(second.activityUsed).toEqual(finish.activity)
  await expect(t.mutation(internal.warmup.mutations.finishRunInternal,
    { ...finish, runId: 'two', activity: { ...finish.activity, likes: -1 } })).rejects.toThrow('Invalid warm-up activity')
  await t.mutation(internal.warmup.mutations.finishRunInternal,
    { ...finish, runId: 'two', activity: { likes: 100, profiles: 100, reels: 100, stories: 100 } })
  expect((await begin('three')).activityUsed).toEqual({ ...first.activityPlan, reels: 103, stories: 100 })
  await t.mutation(internal.warmup.mutations.finishRunInternal,
    { ...finish, runId: 'three', activity: { likes: 0, profiles: 0, reels: 0, stories: 0 } })
  vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))
  const tomorrow = await begin('tomorrow')
  expect(tomorrow.activityPlan?.likes).toBeGreaterThanOrEqual(2)
  expect(tomorrow.activityUsed).toEqual({ likes: 0, profiles: 0, reels: 0, stories: 0, follows: 0, saves: 0, comments: 0 })
})

test('recovery exhausts uncertain activity attempts so a crash cannot repeat engagement', async () => {
  const { t, begin } = await setup({ sessionMinMinutes: 5, sessionMaxMinutes: 5 })
  const first = await begin()
  await t.run(async ctx => {
    const state = (await ctx.db.query('warmupStates').unique())!
    await ctx.db.patch(state._id, { activityUsed: { ...state.activityUsed!, reels: 12, stories: 7 } })
  })
  await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, {})
  const state = await t.run(ctx => ctx.db.query('warmupStates').unique())
  expect(state?.activityUsed).toEqual({ ...first.activityPlan, reels: 12, stories: 7 })
})

test('records actual time once, and releases unused time for another run', async () => {
  const { t, begin, finish, state } = await setup()
  const { date } = await begin()
  await finish(date, 5)
  await finish(date, 5)
  expect(await state()).toMatchObject({ minutesUsedToday: 5, runsToday: 1 })
  expect((await begin()).minutes).toBe(0)
  expect((await begin('two')).minutes).toBe(35)
  await finish(date, 100, 'two')
  expect(await state()).toMatchObject({ minutesUsedToday: 40, runsToday: 2 })
  expect((await begin('three')).minutes).toBe(0)
  const activity = await t.run(ctx => ctx.db.query('analyticsHistory').unique())
  expect(activity?.totals.warmupMinutes).toBe(40)
})

test('a zero-duration run releases the reservation without counting a run', async () => {
  const { begin, finish, state } = await setup()
  const { date } = await begin()
  await finish(date, 0)
  expect(await state()).toMatchObject({ minutesUsedToday: 0, runsToday: 0 })
  expect((await begin('two')).minutes).toBe(40)
})

test('fractional rest durations produce integer deadlines without permitting early runs', async () => {
  vi.useFakeTimers()
  const now = Date.parse('2026-10-09T12:00:00Z')
  vi.setSystemTime(now)
  const { t, begin, finish, state } = await setup({ restMinMinutes: 1.000001, restMaxMinutes: 1.000001 })
  const plan = await begin()
  const finishedAt = await advanceTestClock(t)
  await finish(plan.date, 5)
  const deadline = finishedAt + 60_001
  expect((await state())?.nextRunAt).toBe(deadline)
  vi.setSystemTime(deadline - 1)
  expect((await begin('two')).minutes).toBe(0)
  vi.setSystemTime(deadline)
  expect((await begin('two')).minutes).toBe(35)
})

test('restart recovery rounds rest deadlines and preserves a later stored deadline', async () => {
  vi.useFakeTimers()
  const now = Date.parse('2026-10-09T12:00:00Z')
  vi.setSystemTime(now)
  for (const previous of [0, now + 120_000.25]) {
    const { t, begin, state } = await setup({ restMinMinutes: 1.000001, restMaxMinutes: 1.000001 })
    await begin()
    const row = (await t.run(ctx => ctx.db.query('warmupStates').collect()))[0]
    await t.run(ctx => ctx.db.patch(row._id, { nextRunAt: previous }))
    const recoveredAt = await advanceTestClock(t)
    await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, {})
    await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, {})
    expect((await state())?.nextRunAt).toBe(previous ? now + 120_001 : recoveredAt + 60_001)
    expect((await t.run(ctx => ctx.db.query('analyticsHistory').unique()))?.totals.warmupMinutes).toBe(40)
  }
})

test('rolls over on demand and ignores late finishes from yesterday', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-19T23:59:00Z'))
  const { begin, finish, state } = await setup()
  const yesterday = await begin()
  await finish(yesterday.date, 5)
  vi.setSystemTime(new Date('2026-09-20T00:01:00Z'))
  const today = await begin('two')
  expect(today).toMatchObject({ date: '2026-09-20', day: 2, minutes: 40, remainingMinutes: 40 })
  await finish(yesterday.date, 40)
  expect(await state()).toMatchObject({ day: 2, date: today.date, runsToday: 0, minutesUsedToday: 0 })
})

test('a crashed worker cannot grant extra time, but its reservation expires next day', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-19T12:00:00Z'))
  const { begin } = await setup()
  await begin()
  expect((await begin('retry-worker')).minutes).toBe(0)
  vi.setSystemTime(new Date('2026-09-20T12:00:00Z'))
  expect((await begin('tomorrow')).minutes).toBe(40)
})

test('scheduled maintenance rest days skip all sessions until the next UTC day', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))
  const s = await setup()
  await s.begin(); await s.finish('2026-10-12', 5)
  await s.t.run(async ctx => { const state = await ctx.db.query('warmupStates').unique(); await ctx.db.patch(state!._id, { day: 7, nextRestDate: '2026-10-13' }) })
  vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))
  const rng = vi.spyOn(Math, 'random').mockReturnValue(0)
  try {
    expect((await s.begin('rest-day')).minutes).toBe(0)
    rng.mockReturnValue(0.999)
    expect((await s.begin('rest-day-retry')).minutes).toBe(0)
    expect((await s.state())?.todayMinutes).toBe(0)
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z'))
    expect((await s.begin('next-day')).minutes).toBe(40)
  } finally { rng.mockRestore() }
})

test('rejects invalid usage and reservations for missing profiles', async () => {
  const { t, args, begin, finish } = await setup()
  const { date } = await begin()
  await expect(finish(date, -1)).rejects.toThrow('Invalid elapsed minutes')
  await expect(finish(date, 1, 'wrong')).rejects.toThrow('reservation not found')
  await t.run(ctx => ctx.db.delete(args.profileId))
  await expect(begin('deleted')).rejects.toThrow('Profile not found')
})

test('HTTP begin and finish preserve reservation identity and reject invalid ranges', async () => {
  const { t, args, state } = await setup()
  vi.stubGlobal('process', { env: { INTERNAL_API_KEY: 'test-key' } })
  const post = (path: string, body: unknown) => t.fetch(`/api/warmup/${path}`, {
    method: 'POST', headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect((await post('begin', { ...args, maxMinutes: 0 })).status).toBe(400)
  const response = await post('begin', args)
  expect(response.status).toBe(200)
  const plan = await response.json()
  expect(plan.minutes).toBe(40)
  const follow = { profileId: args.profileId, runId: args.runId, date: plan.date, username: 'fitness' }
  expect(await (await post('begin-follow', follow)).json()).toBe(false)
  expect(await (await post('confirm-follow', follow)).json()).toEqual({ ok: true })
  const finish = { profileId: args.profileId, runId: args.runId, date: plan.date, minutes: 3 }
  expect((await post('finish', finish)).status).toBe(200)
  expect((await post('finish', finish)).status).toBe(200)
  expect(await state()).toMatchObject({ minutesUsedToday: 3, runsToday: 1, reservedMinutes: 0 })
})

test('multiple sessions share one daily budget and respect rest, including retries', async () => {
  vi.useFakeTimers()
  const start = Date.parse('2026-09-19T08:00:00Z')
  vi.setSystemTime(start)
  const { begin, finish, state } = await setup({ sessionMinMinutes: 10, sessionMaxMinutes: 10, restMinMinutes: 60, restMaxMinutes: 60 })
  for (let i = 0; i < 4; i++) {
    const id = `session-${i}`
    const plan = await begin(id)
    expect(plan.minutes).toBe(10)
    expect(await begin(id)).toEqual(plan)
    vi.setSystemTime(start + (i * 70 + 10) * 60_000)
    await finish(plan.date, 10, id)
    const nextRunAt = start + (i + 1) * 70 * 60_000
    expect(await state()).toMatchObject({ todayMinutes: 40, minutesUsedToday: (i + 1) * 10, nextRunAt })
    await finish(plan.date, 10, id)
    expect((await begin('too-early')).minutes).toBe(0)
    vi.setSystemTime(nextRunAt)
  }
  expect((await begin('exhausted')).minutes).toBe(0)
  expect(await state()).toMatchObject({ runsToday: 4, minutesUsedToday: 40 })
})

test('final session is capped to the remaining budget and rest can cross midnight', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-19T23:00:00Z'))
  const { begin, finish, state } = await setup({ sessionMinMinutes: 15, sessionMaxMinutes: 15, restMinMinutes: 0, restMaxMinutes: 0 })
  for (const id of ['one', 'two']) {
    const plan = await begin(id)
    expect(plan.minutes).toBe(15)
    await finish(plan.date, 15, id)
  }
  expect((await begin('three')).minutes).toBe(10)
  await finish('2026-09-19', 10, 'three')
  expect(await state()).toMatchObject({ minutesUsedToday: 40 })

  const resting = await setup({ restMinMinutes: 120, restMaxMinutes: 120 })
  const plan = await resting.begin()
  await resting.finish(plan.date, 5)
  const deadline = (await resting.state())!.nextRunAt!
  vi.setSystemTime(new Date('2026-09-20T00:30:00Z'))
  expect((await resting.begin('tomorrow')).minutes).toBe(0)
  expect(deadline).toBeGreaterThanOrEqual(Date.parse('2026-09-20T01:00:00Z'))
  vi.setSystemTime(deadline)
  expect((await resting.begin('tomorrow')).minutes).toBe(40)
})
