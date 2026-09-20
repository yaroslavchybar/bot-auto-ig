import { expect, test } from 'vitest'
import { api, internal } from '../../convex/_generated/api'
import { defaultRoutine } from '../../convex/routinePolicy'
import { createConvexTest, seedAutomation, seedProfile } from './helpers'

test('startup drains active reservations in batches and leaves historical records untouched', async () => {
  const t = createConvexTest()
  const automation = (await seedAutomation(t, { status: 'running' }))!
  const profile = (await seedProfile(t))!
  const ids = await t.run(async ctx => {
    const leadId = await ctx.db.insert('leads', { username: 'recipient', listIds: [], source: 'test', status: 'reserved', createdAt: 1, updatedAt: 1 })
    const progressId = await ctx.db.insert('accountProgress', { profileId: profile._id, paused: false, activeDays: 0, outreachDays: 0, date: '2026-09-20', used: 1, allowance: 3, nextRunAt: 0, startedAt: 1, updatedAt: 1 })
    const idleWarmup = await ctx.db.insert('warmupStates', { profileId: profile._id, date: '2026-09-20', day: 1, runsToday: 1, todayMinutes: 30, minutesUsedToday: 10, updatedAt: 1 })
    for (let i = 0; i < 101; i++) {
      const profileId = await ctx.db.insert('profiles', { name: `Profile ${i}`, createdAt: 1, using: false })
      await ctx.db.insert('warmupStates', { profileId, date: '2026-09-20', day: 1, runsToday: 1, todayMinutes: 30, minutesUsedToday: 10, activeRun: { id: `run-${i}`, minutes: 5, restMinutes: 60 }, updatedAt: 1 })
      for (const status of ['reserved', 'sending', 'sent', 'cancelled', 'uncertain'] as const) {
        await ctx.db.insert('outreachAttempts', { requestId: `${status}-${i}`, profileId: profile._id, automationId: automation._id, leadId, date: '2026-09-20', message: 'Hello', status, createdAt: 1, updatedAt: 1 })
      }
    }
    return { idleWarmup, progressId, leadId }
  })
  const first = await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, {})
  expect(first).toEqual({ reconciled: 1, hasMore: true })
  expect(await t.run(async ctx => (await ctx.db.query('warmupStates').withIndex('by_active_run', q => q.gt('activeRun.id', undefined)).collect()).length)).toBe(1)
  expect(await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, {})).toEqual({ reconciled: 0 })
  await t.run(async ctx => {
    const warmups = await ctx.db.query('warmupStates').collect()
    expect(warmups.every(row => !row.activeRun)).toBe(true)
    expect(warmups.filter(row => row._id !== ids.idleWarmup).every(row => row.minutesUsedToday === 15)).toBe(true)
    expect(await ctx.db.get(ids.idleWarmup)).toMatchObject({ minutesUsedToday: 10, updatedAt: 1 })
    const attempts = await ctx.db.query('outreachAttempts').collect()
    expect(attempts.filter(row => row.requestId.startsWith('reserved-') || row.requestId.startsWith('sending-')).every(row => row.status === 'uncertain' && row.updatedAt > 1)).toBe(true)
    expect(attempts.filter(row => !row.requestId.startsWith('reserved-') && !row.requestId.startsWith('sending-')).every(row => row.updatedAt === 1)).toBe(true)
    expect(await ctx.db.get(ids.leadId)).toMatchObject({ status: 'uncertain' })
    expect((await ctx.db.get(ids.progressId))?.issue).toContain('Interrupted delivery')
  })
  expect(await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, {})).toEqual({ reconciled: 0 })
  expect(await t.run(async ctx => (await ctx.db.query('warmupStates').collect()).filter(row => row._id !== ids.idleWarmup).every(row => row.minutesUsedToday === 15))).toBe(true)
})

test.each([
  { status: 'idle', isActive: true },
  { status: 'pending', isActive: false },
] as const)('routine conflicts explain how to edit/delete $status automations', async state => {
  const t = createConvexTest()
  const automation = (await seedAutomation(t, { ...state, routine: defaultRoutine }))!
  await expect(t.mutation(api.automations.mutations.update, { id: automation._id, name: 'Changed' })).rejects.toThrow('Disable the automation and wait for the current session to stop before editing')
  await expect(t.mutation(api.automations.mutations.remove, { id: automation._id })).rejects.toThrow('Disable the automation and wait for the current session to stop before deleting')
})
