import { expect, test } from 'vitest'
import { api, internal } from '../../convex/_generated/api'
import { defaultRoutine } from '../../convex/routinePolicy'
import { createConvexTest, seedAutomation, seedProfile } from './helpers'

test('startup drains active reservations in batches and leaves historical records untouched', async () => {
  const t = createConvexTest()
  const automation = (await seedAutomation(t, { status: 'running' }))!
  const profile = (await seedProfile(t))!
  const ids = await t.run(async ctx => {
    const progressId = await ctx.db.insert('accountProgress', { profileId: profile._id, paused: false, activeDays: 0, outreachDays: 0, date: '2026-09-20', used: 1, allowance: 3, nextRunAt: 0, startedAt: 1, updatedAt: 1 })
    const idleWarmup = await ctx.db.insert('warmupStates', { profileId: profile._id, date: '2026-09-20', day: 1, runsToday: 1, todayMinutes: 30, minutesUsedToday: 10, updatedAt: 1 })
    for (let i = 0; i < 101; i++) {
      const profileId = await ctx.db.insert('profiles', { name: `Profile ${i}`, createdAt: 1, using: false })
      await ctx.db.insert('warmupStates', { profileId, date: '2026-09-20', day: 1, runsToday: 1, todayMinutes: 30, minutesUsedToday: 10, activeRun: { id: `run-${i}`, minutes: 5, restMinutes: 60 }, updatedAt: 1 })
      for (const status of ['reserved', 'sending', 'sent', 'cancelled', 'uncertain'] as const) {
        await ctx.db.insert('leads', { username: `${status}-${i}`, listIds: [], source: 'test', senderId: profile._id, dmSent: status === 'sent', followed: false, status: status === 'sent' ? 'contacted' : 'reserved', delivery: { requestId: `${status}-${i}`, automationId: automation._id, date: '2026-09-20', message: 'Hello', state: status }, createdAt: 1, updatedAt: 1 })
      }
    }
    return { idleWarmup, progressId }
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
    const leads = await ctx.db.query('leads').collect()
    expect(leads.filter(row => row.username.startsWith('reserved-') || row.username.startsWith('sending-')).every(row => row.status === 'uncertain' && row.delivery?.state === 'uncertain' && !row.dmSent && row.updatedAt > 1)).toBe(true)
    expect(leads.filter(row => !row.username.startsWith('reserved-') && !row.username.startsWith('sending-')).every(row => row.updatedAt === 1)).toBe(true)
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
