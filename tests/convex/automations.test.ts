import { expect, test } from 'vite-plus/test'

import { api, internal } from '../../convex/_generated/api'
import { createConvexTest, insertDoc, seedModel, seedAutomation } from './helpers'
import { defaultRoutine } from '../../convex/routinePolicy'

test('sleeping routines resume on wake and become editable when disabled', async () => {
  const t = createConvexTest()
  const model = await seedModel(t)
  const automation = await seedAutomation(t, { modelIds: [model!._id], status: 'running', routine: defaultRoutine })
  const pending = await t.mutation(internal.automations.mutations.updateStatusInternal, { id: automation!._id, status: 'pending' })
  expect(pending?.status).toBe('pending')
  const resumed = await t.mutation(internal.automations.mutations.startInternal, { id: automation!._id })
  expect(resumed?.status).toBe('pending')
  const disabled = await t.mutation(api.automations.mutations.setActive, { id: automation!._id, isActive: false })
  expect(disabled).toMatchObject({ status: 'cancelled', isActive: false })
  expect((await t.mutation(api.automations.mutations.update, { id: automation!._id, name: 'Editable' }))?.name).toBe('Editable')
})

test('automation get returns null for malformed route ids', async () => {
  const t = createConvexTest()
  const automation = await seedAutomation(t, { name: 'Automation Get Check' })
  expect(await t.query(internal.automations.queries.getInternal, { id: String(automation!._id) })).toMatchObject({
    name: 'Automation Get Check',
  })
  expect(await t.query(internal.automations.queries.getInternal, { id: 'not-a-automation-id' })).toBeNull()
})

test('creates automations, deduplicates list ids, and transitions status', async () => {
  const t = createConvexTest()
  const list = await seedModel(t, 'List A')

  const created = await t.mutation(api.automations.mutations.create, {
    name: '  Automation A  ',
    description: 'automation', routine: defaultRoutine,
    modelIds: [list!._id, list!._id],
  })
  expect(created?.isActive).toBe(false)
  await t.mutation(api.automations.mutations.setActive, { id: created!._id, isActive: true })
  const started = await t.mutation(internal.automations.mutations.startInternal, { id: created!._id })
  const running = await t.mutation(internal.automations.mutations.updateStatusInternal, {
    id: created!._id,
    status: 'running',
  })
  const completed = await t.mutation(internal.automations.mutations.updateStatusInternal, {
    id: created!._id,
    status: 'completed',
  })

  expect(created).toMatchObject({
    name: 'Automation A',
    modelIds: [list!._id],
  })
  expect(started?.status).toBe('pending')
  expect(running).toMatchObject({
    status: 'running',
  })
  expect(running?.startedAt).toEqual(expect.any(Number))
  expect(completed?.status).toBe('completed')
  expect(completed?.completedAt).toEqual(expect.any(Number))
})

test('allows pending-running-paused-running transitions for active runs', async () => {
  const t = createConvexTest()
  const automation = await seedAutomation(t, {
    name: 'Automation Transition Check',
    status: 'pending',
  })

  const running = await t.mutation(internal.automations.mutations.updateStatusInternal, {
    id: automation!._id,
    status: 'running',
  })
  const paused = await t.mutation(internal.automations.mutations.updateStatusInternal, {
    id: automation!._id,
    status: 'paused',
  })
  const resumed = await t.mutation(internal.automations.mutations.updateStatusInternal, {
    id: automation!._id,
    status: 'running',
  })

  expect(running?.status).toBe('running')
  expect(paused?.status).toBe('paused')
  expect(resumed?.status).toBe('running')
})

test('lists automations without schedule-era counters', async () => {
  const t = createConvexTest()
  await insertDoc(t, 'automations', {
    name: 'Automation C',
    description: 'plain run',
    modelIds: [],
    status: 'idle',
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })

  const rows = await t.query(api.automations.queries.list, {})

  expect(rows[0]).toMatchObject({ name: 'Automation C', isActive: true })
  expect(rows[0]).not.toHaveProperty('runsToday')
})

test('disabled automations cannot start but can be re-enabled', async () => {
  const t = createConvexTest()
  const automation = await seedAutomation(t, { status: 'idle', isActive: false })
  await expect(t.mutation(internal.automations.mutations.startInternal, { id: automation!._id })).rejects.toThrow('disabled')
  const enabled = await t.mutation(api.automations.mutations.setActive, { id: automation!._id, isActive: true })
  expect(enabled?.isActive).toBe(true)
  const started = await t.mutation(internal.automations.mutations.startInternal, { id: automation!._id })
  expect(started?.status).toBe('pending')
  const disabled = await t.mutation(api.automations.mutations.setActive, { id: automation!._id, isActive: false })
  expect(disabled?.isActive).toBe(false)
})

test('new automations start disabled', async () => {
  const t = createConvexTest()
  const created = await t.mutation(api.automations.mutations.create, {
    name: 'Automation D', routine: defaultRoutine, modelIds: [(await seedModel(t))!._id],
    })
  expect(created?.isActive).toBe(false)
})
