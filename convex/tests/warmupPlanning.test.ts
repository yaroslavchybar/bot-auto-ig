import { afterEach, expect, test, vi } from 'vite-plus/test'
import { internal } from '../_generated/api'
import { createConvexTest, seedProfile } from '../../tests/convex/helpers'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

async function setup() {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-17T12:00:00Z'))
  const t = createConvexTest(), profile = (await seedProfile(t))!
  const args = { profileId: profile._id, minMinutes: 40, maxMinutes: 40 }
  const prepare = () => t.mutation(internal.warmup.mutations.prepareDayInternal, args)
  const begin = () => t.mutation(internal.warmup.mutations.beginRunInternal, { ...args,
    automationId: 'automation', runId: 'session', sessionMinMinutes: 10, sessionMaxMinutes: 10,
    restMinMinutes: 0, restMaxMinutes: 0 })
  const state = () => t.run(ctx => ctx.db.query('warmupStates').withIndex('by_profile', q => q.eq('profileId', profile._id)).unique())
  return { t, args, profile, prepare, begin, state }
}

test('prelaunch planning saves a rest day once without creating a session reservation', async () => {
  const s = await setup()
  await s.t.run(ctx => ctx.db.insert('warmupStates', { profileId: s.profile._id, day: 8,
    date: '2026-10-16', nextRestDate: '2026-10-17', runsToday: 1, todayMinutes: 40, minutesUsedToday: 10, }))
  const rng = vi.spyOn(Math, 'random').mockReturnValue(0)
  expect(await s.prepare()).toBe(false)
  const saved = await s.state()
  expect(saved).toMatchObject({ date: '2026-10-17', nextRestDate: '2026-10-22', day: 9, todayMinutes: 0, runsToday: 0, minutesUsedToday: 0 })
  expect(saved?.activeRun).toBeUndefined()
  rng.mockReturnValue(0.99)
  expect(await s.prepare()).toBe(false)
  expect((await s.begin()).minutes).toBe(0)
  expect(await s.state()).toEqual(saved)
  vi.setSystemTime(new Date('2026-10-18T12:00:00Z'))
  expect(await s.prepare()).toBe(true)
  expect((await s.state())?.todayMinutes).toBe(40)
  expect((await s.state())?.nextRestDate).toBe('2026-10-22')
})

test.each([
  [0, 5], [0.5, 6], [0.999, 7],
])('rest intervals stay fixed at %s RNG / %i days and never repeat the next day', async (random, interval) => {
  const s = await setup()
  await s.t.run(ctx => ctx.db.insert('warmupStates', {
    profileId: s.profile._id, day: 8, date: '2026-10-16', runsToday: 1,
    todayMinutes: 40, minutesUsedToday: 10,
  }))
  const rng = vi.spyOn(Math, 'random').mockReturnValue(random)
  const restDate = `2026-10-${17 + interval}`
  expect(await s.prepare()).toBe(true)
  expect((await s.state())?.nextRestDate).toBe(restDate)
  // Changing randomness must not move a rest day that has already been scheduled.
  rng.mockReturnValue(0)
  for (let elapsed = 1; elapsed <= interval; elapsed++) {
    vi.setSystemTime(new Date(`2026-10-${17 + elapsed}T12:00:00Z`))
    expect(await s.prepare()).toBe(elapsed < interval)
    expect((await s.state())?.todayMinutes).toBe(elapsed < interval ? 40 : 0)
    expect((await s.state())?.nextRestDate).toBe(elapsed < interval ? restDate : `2026-10-${22 + interval}`)
  }
  for (let elapsed = 1; elapsed < 5; elapsed++) {
    vi.setSystemTime(new Date(`2026-10-${17 + interval + elapsed}T12:00:00Z`))
    expect(await s.prepare()).toBe(true)
  }
  vi.setSystemTime(new Date(`2026-10-${22 + interval}T12:00:00Z`))
  expect(await s.prepare()).toBe(false)
})

test('an existing rest day anchors the schedule instead of allowing another rest tomorrow', async () => {
  const s = await setup()
  await s.t.run(ctx => ctx.db.insert('warmupStates', {
    profileId: s.profile._id, day: 8, date: '2026-10-16', runsToday: 0,
    todayMinutes: 0, minutesUsedToday: 0,
  }))
  vi.spyOn(Math, 'random').mockReturnValue(0)
  expect(await s.prepare()).toBe(true)
  expect(await s.state()).toMatchObject({ todayMinutes: 40, nextRestDate: '2026-10-21' })
})

test('the first week has no rest days or maintenance schedule', async () => {
  const s = await setup()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  for (let day = 1; day <= 7; day++) {
    vi.setSystemTime(new Date(`2026-10-${16 + day}T12:00:00Z`))
    expect(await s.prepare()).toBe(true)
    expect((await s.state())?.nextRestDate).toBeUndefined()
    const session = await s.begin()
    await s.t.mutation(internal.warmup.mutations.finishRunInternal, {
      profileId: s.profile._id, runId: 'session', date: session.date, minutes: session.minutes,
    })
  }
  vi.setSystemTime(new Date('2026-10-24T12:00:00Z'))
  expect(await s.prepare()).toBe(true)
  expect(await s.state()).toMatchObject({ day: 8, nextRestDate: '2026-10-29' })
})

test('returning after a long pause takes one rest day without catching up missed rest days', async () => {
  const s = await setup()
  await s.t.run(ctx => ctx.db.insert('warmupStates', {
    profileId: s.profile._id, day: 8, date: '2026-09-01', nextRestDate: '2026-09-06',
    runsToday: 1, todayMinutes: 40, minutesUsedToday: 10,
  }))
  vi.spyOn(Math, 'random').mockReturnValue(0)
  expect(await s.prepare()).toBe(false)
  expect(await s.state()).toMatchObject({ todayMinutes: 0, nextRestDate: '2026-10-22' })
  vi.setSystemTime(new Date('2026-10-18T12:00:00Z'))
  expect(await s.prepare()).toBe(true)
})

test('an active day is planned without reserving time; the later session reuses that budget', async () => {
  const s = await setup()
  expect(await s.prepare()).toBe(true)
  const saved = (await s.state())!
  expect(saved.todayMinutes).toBe(40)
  expect(saved.activeRun).toBeUndefined()
  expect(await s.prepare()).toBe(true)
  expect(await s.state()).toEqual(saved)
  expect((await s.begin()).minutes).toBe(10)
  expect((await s.state())?.todayMinutes).toBe(40)
  expect(await s.prepare()).toBe(false)
})

test.each(['resting', 'exhausted', 'paused'] as const)('prelaunch planning refuses a %s profile', async condition => {
  const s = await setup()
  await s.prepare()
  await s.t.run(async ctx => {
    const state = (await ctx.db.query('warmupStates').unique())!
    if (condition === 'paused') await ctx.db.patch(s.profile._id, { paused: true })
    else await ctx.db.patch(state._id, condition === 'resting'
      ? { nextRunAt: Date.now() + 60_000 } : { minutesUsedToday: 40 })
  })
  const saved = await s.state()
  expect(await s.prepare()).toBe(false)
  expect(await s.state()).toEqual(saved)
})

test('HTTP prelaunch planning validates input and creates no active reservation', async () => {
  const s = await setup()
  vi.stubGlobal('process', { env: { INTERNAL_API_KEY: 'test-key' } })
  const post = (body: object) => s.t.fetch('/api/warmup/prepare', {
    method: 'POST', headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect((await post({ ...s.args, maxMinutes: 0 })).status).toBe(400)
  expect((await post({ minMinutes: 40, maxMinutes: 40 })).status).toBe(400)
  const response = await post(s.args)
  expect(response.status).toBe(200)
  expect(await response.json()).toBe(true)
  expect((await s.state())?.activeRun).toBeUndefined()
})
