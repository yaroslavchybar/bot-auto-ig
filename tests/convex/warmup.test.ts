import { expect, test, vi, afterEach } from 'vitest'
import { api, internal } from '../../convex/_generated/api'
import { createConvexTest, seedProfile } from './helpers'

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

test('records actual time once, and releases unused time for another run', async () => {
  const { begin, finish, state } = await setup()
  const { date } = await begin()
  await finish(date, 5)
  await finish(date, 5)
  expect(await state()).toMatchObject({ minutesUsedToday: 5, runsToday: 1 })
  expect((await begin()).minutes).toBe(0)
  expect((await begin('two')).minutes).toBe(35)
  await finish(date, 100, 'two')
  expect(await state()).toMatchObject({ minutesUsedToday: 40, runsToday: 2 })
  expect((await begin('three')).minutes).toBe(0)
})

test('a zero-duration run releases the reservation without counting a run', async () => {
  const { begin, finish, state } = await setup()
  const { date } = await begin()
  await finish(date, 0)
  expect(await state()).toMatchObject({ minutesUsedToday: 0, runsToday: 0 })
  expect((await begin('two')).minutes).toBe(40)
})

test('rolls over on demand and ignores late finishes from yesterday', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-19T23:59:00Z'))
  const { begin, finish, state } = await setup()
  const yesterday = await begin()
  await finish(yesterday.date, 5)
  vi.setSystemTime(new Date('2026-09-20T00:01:00Z'))
  const today = await begin('two')
  expect(today).toEqual({ date: '2026-09-20', minutes: 40 })
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
  vi.setSystemTime(new Date('2026-09-20T00:30:00Z'))
  expect((await resting.begin('tomorrow')).minutes).toBe(0)
  vi.setSystemTime(new Date('2026-09-20T01:00:00Z'))
  expect((await resting.begin('tomorrow')).minutes).toBe(40)
})
