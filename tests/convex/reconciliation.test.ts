import { expect, test, vi } from 'vite-plus/test'
import { api, internal } from '../../convex/_generated/api'
import { defaultRoutine } from '../../convex/routinePolicy'
import { createConvexTest, seedAutomation, seedProfile } from './helpers'

test('startup drains interrupted warmups without scanning leads', async () => {
  const t = createConvexTest()
  await seedAutomation(t, { status: 'running' })
  const profile = (await seedProfile(t))!
  const ids = await t.run(async ctx => {
    const idleWarmup = await ctx.db.insert('warmupStates', { profileId: profile._id, date: '2026-09-20', day: 1, runsToday: 1, todayMinutes: 30, minutesUsedToday: 10, updatedAt: 1 })
    for (let i = 0; i < 101; i++) {
      const profileId = await ctx.db.insert('profiles', { name: `Profile ${i}`, createdAt: 1, using: false })
      await ctx.db.insert('warmupStates', { profileId, date: '2026-09-20', day: 1, runsToday: 1, todayMinutes: 30, minutesUsedToday: 10, activeRun: { id: `run-${i}`, minutes: 5, restMinutes: 60 }, updatedAt: 1 })
    }
    return { idleWarmup }
  })
  const first = await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, {})
  expect(first).toMatchObject({ reconciled: 1, hasMore: true, cursor: expect.any(String) })
  expect(await t.run(async ctx => (await ctx.db.query('warmupStates').withIndex('by_active_run', q => q.gt('activeRun.id', undefined)).collect()).length)).toBe(1)
  expect(await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, { cursor: first.cursor })).toEqual({ reconciled: 0 })
  await t.run(async ctx => {
    const warmups = await ctx.db.query('warmupStates').collect()
    expect(warmups.every(row => !row.activeRun)).toBe(true)
    expect(warmups.filter(row => row._id !== ids.idleWarmup).every(row => row.minutesUsedToday === 15)).toBe(true)
    expect(await ctx.db.get(ids.idleWarmup)).toMatchObject({ minutesUsedToday: 10, updatedAt: 1 })

  })
  expect(await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, {})).toEqual({ reconciled: 0 })
  expect(await t.run(async ctx => (await ctx.db.query('warmupStates').collect()).filter(row => row._id !== ids.idleWarmup).every(row => row.minutesUsedToday === 15))).toBe(true)
})

test('restart preserves waiting routines and recovers interrupted sessions without clearing checkpoints', async () => {
  const t = createConvexTest()
  const waiting = (await seedAutomation(t, {
    routine: defaultRoutine, status: 'pending', updatedAt: 1, nodeStates: { saved: true },
  }))!
  const before = await t.run(ctx => ctx.db.get(waiting._id))
  const running = (await seedAutomation(t, {
    routine: defaultRoutine, status: 'running', startedAt: 1, nodeStates: { saved: true },
  }))!
  const disabled = (await seedAutomation(t, {
    routine: defaultRoutine, status: 'running', isActive: false,
  }))!
  const disabledPending = (await seedAutomation(t, {
    routine: defaultRoutine, status: 'pending', isActive: false,
  }))!

  expect(await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, {}))
    .toEqual({ reconciled: 3 })
  expect(await t.run(ctx => ctx.db.get(waiting._id))).toEqual(before)
  const recovered = await t.run(ctx => ctx.db.get(running._id))
  expect(recovered).toMatchObject({ status: 'pending', isActive: true, nodeStates: { saved: true } })
  expect(recovered?.error).toBeUndefined()
  expect(recovered?.startedAt).toBeUndefined()
  expect(recovered?.completedAt).toBeUndefined()
  for (const row of [disabled, disabledPending]) {
    expect(await t.run(ctx => ctx.db.get(row._id))).toMatchObject({ status: 'cancelled', isActive: false })
  }
  const resumed = await t.mutation(internal.automations.mutations.startInternal, { id: running._id })
  expect(resumed?.nodeStates).toEqual({ saved: true })
  expect(await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, {}))
    .toEqual({ reconciled: 0 })
})

test('restart repairs old routine restart errors while preserving genuine and graph failures', async () => {
  const t = createConvexTest()
  const restartError = 'Server restarted during execution'
  const oldFailure = (await seedAutomation(t, {
    routine: defaultRoutine, status: 'failed', error: restartError, completedAt: 1,
  }))!
  const disabled = (await seedAutomation(t, {
    routine: defaultRoutine, status: 'failed', error: restartError, isActive: false,
  }))!
  const genuine = (await seedAutomation(t, {
    routine: defaultRoutine, status: 'failed', error: 'Could not open browser',
  }))!
  const graph = (await seedAutomation(t, { status: 'failed', error: restartError }))!
  const unchanged = await t.run(async ctx => Promise.all([ctx.db.get(genuine._id), ctx.db.get(graph._id)]))

  expect(await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, {}))
    .toEqual({ reconciled: 2 })
  const recovered = await t.run(ctx => ctx.db.get(oldFailure._id))
  expect(recovered?.status).toBe('pending')
  expect(recovered?.error).toBeUndefined()
  expect(recovered?.completedAt).toBeUndefined()
  expect((await t.run(ctx => ctx.db.get(disabled._id)))?.status).toBe('cancelled')
  expect(await t.run(async ctx => Promise.all([ctx.db.get(genuine._id), ctx.db.get(graph._id)])))
    .toEqual(unchanged)
})

test('restart charges reserved time once without shortening an existing cooldown or changing daily progress', async () => {
  const t = createConvexTest()
  const profile = (await seedProfile(t))!
  const nextRunAt = Date.now() + 3 * 60 * 60_000
  const ids = await t.run(async ctx => {
    const warmup = await ctx.db.insert('warmupStates', {
      profileId: profile._id, date: '2026-10-01', day: 1, runsToday: 1,
      todayMinutes: 30, minutesUsedToday: 28, nextRunAt,
      activeRun: { id: 'reserved-run', minutes: 5, restMinutes: 60 }, updatedAt: 1,
    })
    const progress = await ctx.db.insert('accountProgress', {
      profileId: profile._id, paused: false, activeDays: 1, outreachDays: 1,
      date: '2026-10-01', used: 10, allowance: 10, nextRunAt, startedAt: 1, updatedAt: 1,
    })
    return { warmup, progress }
  })
  const before = await t.run(ctx => ctx.db.get(ids.progress))
  await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, {})
  await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, {})
  const warmup = await t.run(ctx => ctx.db.get(ids.warmup))
  expect(warmup).toMatchObject({ minutesUsedToday: 30, todayMinutes: 30, runsToday: 1, nextRunAt })
  expect(warmup?.activeRun).toBeUndefined()
  expect(await t.run(ctx => ctx.db.get(ids.progress))).toEqual(before)
})

test.each(['running', 'failed'] as const)('restart drains $0 routine batches without looping over waiting routines or skipping graph runs', async status => {
  const t = createConvexTest()
  const graph = (await seedAutomation(t, { status: 'pending' }))!
  await t.run(async ctx => {
    for (let index = 0; index < 101; index++) {
      await ctx.db.insert('automations', {
        name: `Routine ${index}`, routine: defaultRoutine, status,
        ...(status === 'failed' ? { error: 'Server restarted during execution' } : {}),
        isActive: true, nodes: [], edges: [], createdAt: 1, updatedAt: 1,
      })
    }
  })
  let batch = await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, {})
  expect(batch).toMatchObject({ reconciled: 100, hasMore: true, cursor: expect.any(String) })
  let reconciled = batch.reconciled
  let calls = 1
  while (batch.hasMore && calls < 5) {
    batch = await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, { cursor: batch.cursor })
    reconciled += batch.reconciled
    calls++
  }
  expect(batch.hasMore).toBeUndefined()
  expect(reconciled).toBe(102)
  batch = await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, {})
  expect(batch.reconciled).toBe(0)
  expect(batch.hasMore).toBe(true)
  expect(await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, { cursor: batch.cursor }))
    .toEqual({ reconciled: 0 })
  expect((await t.run(ctx => ctx.db.get(graph._id)))?.status).toBe('failed')
  expect(await t.run(async ctx => (await ctx.db.query('automations').collect())
    .filter(row => row.routine).every(row => row.status === 'pending'))).toBe(true)
})

test.each(['pending', 'failed'] as const)('recovery bounds scans through sparse $0 candidates and resumes from its cursor', async status => {
  const t = createConvexTest()
  await t.run(async ctx => {
    for (let index = 0; index < 250; index++) {
      await ctx.db.insert('automations', {
        name: `Unchanged ${index}`, routine: defaultRoutine, status,
        ...(status === 'failed' ? { error: 'Genuine failure' } : {}),
        isActive: true, nodes: [], edges: [], createdAt: 1, updatedAt: 1,
      })
    }
  })
  const candidate = (await seedAutomation(t, {
    status,
    ...(status === 'failed' ? { routine: defaultRoutine, error: 'Server restarted during execution' } : {}),
  }))!
  const first = await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, {})
  expect(first).toMatchObject({ reconciled: 0, hasMore: true, cursor: expect.any(String) })
  const second = await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, { cursor: first.cursor })
  expect(second).toMatchObject({ reconciled: 0, hasMore: true, cursor: expect.any(String) })
  expect(second.cursor).not.toBe(first.cursor)
  const last = await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, { cursor: second.cursor })
  expect(last).toEqual({ reconciled: 1 })
  expect((await t.run(ctx => ctx.db.get(candidate._id)))?.status)
    .toBe(status === 'pending' ? 'failed' : 'pending')
  expect(await t.run(async ctx => (await ctx.db.query('automations').collect())
    .filter(row => row._id !== candidate._id).every(row => row.status === status && row.updatedAt === 1))).toBe(true)
})

test('authenticated recovery HTTP route forwards cursors and rejects invalid cursor types', async () => {
  vi.stubEnv('INTERNAL_API_KEY', 'recovery-key')
  try {
    const t = createConvexTest()
    await t.run(async ctx => {
      for (let index = 0; index < 101; index++) {
        await ctx.db.insert('automations', {
          name: `Waiting ${index}`, routine: defaultRoutine, status: 'pending',
          isActive: true, nodes: [], edges: [], createdAt: 1, updatedAt: 1,
        })
      }
    })
    const graph = (await seedAutomation(t, { status: 'pending' }))!
    const request = (body: Record<string, unknown>) => t.fetch('/api/automations/reconcile', {
      method: 'POST', headers: { authorization: 'Bearer recovery-key', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const first = await request({})
    expect(first.status).toBe(200)
    const batch = await first.json()
    expect(batch).toMatchObject({ reconciled: 0, hasMore: true, cursor: expect.any(String) })
    const second = await request({ cursor: batch.cursor })
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ reconciled: 1 })
    expect((await t.run(ctx => ctx.db.get(graph._id)))?.status).toBe('failed')
    expect((await request({ cursor: 42 })).status).toBe(400)
  } finally {
    vi.unstubAllEnvs()
  }
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
