import { expect, test } from 'vitest'

import { api, internal } from '../../convex/_generated/api'
import { planFromConfig } from '../../convex/warmup/helpers'
import { createConvexTest, insertDoc, seedAutomation, seedProfile } from './helpers'

function warmupNode(config: Record<string, unknown> = {}) {
  return { id: 'warm', data: { activityId: 'browse_feed', config } }
}

test('zero-minute plans clamp to at least one minute', () => {
  expect(planFromConfig({ warmup_min_minutes: 0, warmup_max_minutes: 0 }))
    .toEqual({ minMinutes: 1, maxMinutes: 1 })
  expect(planFromConfig({ warmup_min_minutes: 30, warmup_max_minutes: 10 }))
    .toEqual({ minMinutes: 30, maxMinutes: 30 })
})

test('first warm-up run creates the day 1 state', async () => {
  const t = createConvexTest()
  const profile = await seedProfile(t, { name: 'Warm A' })
  const automation = await seedAutomation(t, { nodes: [warmupNode()] })

  const state = await t.mutation(internal.warmup.mutations.recordRunInternal, {
    profileId: profile!._id,
    automationId: String(automation!._id),
    minutes: 10,
    todayMinutes: 40,
    runId: 'run-1',
  })

  expect(state).toMatchObject({ day: 1, runsToday: 1, todayMinutes: 40, minutesUsedToday: 10 })
  expect(await t.query(api.warmup.queries.getByProfile, { profileId: profile!._id }))
    .toMatchObject({ day: 1, runsToday: 1 })
})

test('repeat runs the same day increment the counter without bumping the day', async () => {
  const t = createConvexTest()
  const profile = await seedProfile(t, { name: 'Warm B' })
  const automation = await seedAutomation(t, { nodes: [warmupNode()] })
  const args = { profileId: profile!._id, automationId: String(automation!._id), minutes: 10, todayMinutes: 40, runId: 'run-1' }

  await t.mutation(internal.warmup.mutations.recordRunInternal, args)
  const second = await t.mutation(internal.warmup.mutations.recordRunInternal, { ...args, minutes: 5, runId: 'run-2' })

  expect(second).toMatchObject({ day: 1, runsToday: 2, todayMinutes: 40, minutesUsedToday: 15 })
})

test('a retried record with the same run id does not double-count', async () => {
  const t = createConvexTest()
  const profile = await seedProfile(t, { name: 'Warm B2' })
  const automation = await seedAutomation(t, { nodes: [warmupNode()] })
  const args = { profileId: profile!._id, automationId: String(automation!._id), minutes: 10, todayMinutes: 40, runId: 'run-1' }

  await t.mutation(internal.warmup.mutations.recordRunInternal, args)
  const retry = await t.mutation(internal.warmup.mutations.recordRunInternal, args)

  expect(retry).toMatchObject({ day: 1, runsToday: 1, minutesUsedToday: 10 })
})

test('a retry arriving after later runs still does not double-count', async () => {
  const t = createConvexTest()
  const profile = await seedProfile(t, { name: 'Warm B3' })
  const automation = await seedAutomation(t, { nodes: [warmupNode()] })
  const base = { profileId: profile!._id, automationId: String(automation!._id), minutes: 10, todayMinutes: 40 }

  await t.mutation(internal.warmup.mutations.recordRunInternal, { ...base, runId: 'run-a' })
  await t.mutation(internal.warmup.mutations.recordRunInternal, { ...base, runId: 'run-b' })
  const retryA = await t.mutation(internal.warmup.mutations.recordRunInternal, { ...base, runId: 'run-a' })

  expect(retryA).toMatchObject({ day: 1, runsToday: 2 })
})

test('over-reported durations only consume the remaining budget', async () => {
  const t = createConvexTest()
  const profile = await seedProfile(t, { name: 'Warm H' })
  const automation = await seedAutomation(t, { nodes: [warmupNode()] })
  const base = { profileId: profile!._id, automationId: String(automation!._id), todayMinutes: 40 }

  await t.mutation(internal.warmup.mutations.recordRunInternal, { ...base, minutes: 10, runId: 'run-1' })
  // Lies about 50 minutes with only 30 left: run counts, usage caps at 40.
  const capped = await t.mutation(internal.warmup.mutations.recordRunInternal, { ...base, minutes: 50, runId: 'run-2' })

  expect(capped).toMatchObject({ runsToday: 2, todayMinutes: 40, minutesUsedToday: 40 })
})

test('legacy rows with prior runs count as fully consumed', async () => {
  const t = createConvexTest()
  const profile = await seedProfile(t, { name: 'Warm I' })
  const automation = await seedAutomation(t, { nodes: [warmupNode()] })
  await insertDoc(t, 'warmupStates', {
    profileId: profile!._id,
    day: 2,
    date: new Date().toISOString().slice(0, 10),
    runsToday: 2,
    todayMinutes: 30,
    lastAutomationId: String(automation!._id),
    updatedAt: Date.now(),
  })

  const state = await t.mutation(internal.warmup.mutations.recordRunInternal, {
    profileId: profile!._id,
    automationId: String(automation!._id),
    minutes: 10,
    todayMinutes: 30,
    runId: 'run-1',
  })

  expect(state).toMatchObject({ day: 2, runsToday: 3, todayMinutes: 30, minutesUsedToday: 30 })
})

test('daily rollover bumps the day, resets the counter, and assigns random minutes from the node plan', async () => {
  const t = createConvexTest()
  const profile = await seedProfile(t, { name: 'Warm C' })
  const automation = await seedAutomation(t, {
    nodes: [warmupNode({ warmup_min_minutes: 30, warmup_max_minutes: 40 })],
  })
  await insertDoc(t, 'warmupStates', {
    profileId: profile!._id,
    day: 3,
    date: '2000-01-01',
    runsToday: 2,
    todayMinutes: 15,
    minutesUsedToday: 15,
    lastAutomationId: String(automation!._id),
    updatedAt: Date.now(),
  })

  const result = await t.mutation(internal.warmup.mutations.rolloverDayInternal, {})

  expect(result).toMatchObject({ rolled: 1, done: true })
  // Day 3 -> 4, minutes random within the node plan range, usage reset.
  const rolled = await t.query(api.warmup.queries.getByProfile, { profileId: profile!._id })
  expect(rolled).toMatchObject({ day: 4, runsToday: 0, minutesUsedToday: 0 })
  expect(rolled?.todayMinutes).toBeGreaterThanOrEqual(30)
  expect(rolled?.todayMinutes).toBeLessThanOrEqual(40)
})

test('daily rollover keeps the day when warm-up did not run', async () => {
  const t = createConvexTest()
  const profile = await seedProfile(t, { name: 'Warm D' })
  await seedAutomation(t, { nodes: [warmupNode()] })
  await insertDoc(t, 'warmupStates', {
    profileId: profile!._id,
    day: 2,
    date: '2000-01-01',
    runsToday: 0,
    todayMinutes: 15,
    minutesUsedToday: 0,
    updatedAt: Date.now(),
  })

  await t.mutation(internal.warmup.mutations.rolloverDayInternal, {})

  // No bump, but today's minutes are still assigned from defaults (30-60).
  const kept = await t.query(api.warmup.queries.getByProfile, { profileId: profile!._id })
  expect(kept).toMatchObject({ day: 2, runsToday: 0 })
  expect(kept?.todayMinutes).toBeGreaterThanOrEqual(30)
  expect(kept?.todayMinutes).toBeLessThanOrEqual(60)
})

test('a run after a missed cron rolls the row over first', async () => {
  const t = createConvexTest()
  const profile = await seedProfile(t, { name: 'Warm E' })
  const automation = await seedAutomation(t, { nodes: [warmupNode()] })
  await insertDoc(t, 'warmupStates', {
    profileId: profile!._id,
    day: 1,
    date: '2000-01-01',
    runsToday: 3,
    todayMinutes: 10,
    minutesUsedToday: 10,
    lastAutomationId: String(automation!._id),
    updatedAt: Date.now(),
  })

  const state = await t.mutation(internal.warmup.mutations.recordRunInternal, {
    profileId: profile!._id,
    automationId: String(automation!._id),
    minutes: 15,
    todayMinutes: 30,
    runId: 'run-1',
  })

  expect(state).toMatchObject({ day: 2, runsToday: 1, todayMinutes: 30, minutesUsedToday: 15 })
})

test('reading state and running the cron never create a row', async () => {
  const t = createConvexTest()
  const profile = await seedProfile(t, { name: 'Warm G' })

  expect(await t.query(api.warmup.queries.getByProfile, { profileId: profile!._id })).toBeNull()
  expect(await t.query(api.warmup.queries.list, {})).toEqual([])
  await t.mutation(internal.warmup.mutations.rolloverDayInternal, {})
  expect(await t.query(api.warmup.queries.list, {})).toEqual([])
})

test('warm-up list exposes all states', async () => {
  const t = createConvexTest()
  const profile = await seedProfile(t, { name: 'Warm F' })
  const automation = await seedAutomation(t, { nodes: [warmupNode()] })
  await t.mutation(internal.warmup.mutations.recordRunInternal, {
    profileId: profile!._id,
    automationId: String(automation!._id),
    minutes: 10,
    todayMinutes: 40,
    runId: 'run-1',
  })

  const states = await t.query(api.warmup.queries.list, {})
  expect(states).toHaveLength(1)
  expect(states[0]).toMatchObject({ day: 1, runsToday: 1, todayMinutes: 40, minutesUsedToday: 10 })
})
