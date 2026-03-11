import { expect, test, vi } from 'vitest'

import { api, internal } from '../../convex/_generated/api'
import { createConvexTest, insertDoc, seedList, seedWorkflow } from './helpers'

test('creates workflows, deduplicates list ids, and transitions status', async () => {
  const t = createConvexTest()
  const list = await seedList(t, 'List A')

  const created = await t.mutation(api.workflows.create, {
    name: '  Workflow A  ',
    description: 'workflow',
    nodes: [],
    edges: [],
    listIds: [list!._id, list!._id],
  })
  const started = await t.mutation(api.workflows.start, { id: created!._id })
  const running = await t.mutation(api.workflows.updateStatus, {
    id: created!._id,
    status: 'running',
    currentNodeId: 'node-1',
    nodeStates: { 'node-1': 'running' },
  })
  const completed = await t.mutation(api.workflows.updateStatus, {
    id: created!._id,
    status: 'completed',
  })

  expect(created).toMatchObject({
    name: 'Workflow A',
    listIds: [list!._id],
  })
  expect(started?.status).toBe('pending')
  expect(running).toMatchObject({
    status: 'running',
    currentNodeId: 'node-1',
  })
  expect(running?.startedAt).toEqual(expect.any(Number))
  expect(completed?.status).toBe('completed')
  expect(completed?.completedAt).toEqual(expect.any(Number))
})

test('allows pending-running-paused-running transitions for active runs', async () => {
  const t = createConvexTest()
  const workflow = await seedWorkflow(t, {
    name: 'Workflow Transition Check',
    status: 'pending',
  })

  const running = await t.mutation(api.workflows.updateStatus, {
    id: workflow!._id,
    status: 'running',
  })
  const paused = await t.mutation(api.workflows.updateStatus, {
    id: workflow!._id,
    status: 'paused',
  })
  const resumed = await t.mutation(api.workflows.updateStatus, {
    id: workflow!._id,
    status: 'running',
  })

  expect(running?.status).toBe('running')
  expect(paused?.status).toBe('paused')
  expect(resumed?.status).toBe('running')
})

test('executes instant workflows through scheduler and mocked fetch boundaries', async () => {
  vi.useFakeTimers()

  const t = createConvexTest()
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('process', {
    env: {
      SERVER_URL: 'http://localhost:5000',
      INTERNAL_API_KEY: 'secret-token',
    },
  })

  const workflow = await seedWorkflow(t, {
    name: 'Workflow B',
    isActive: true,
    scheduleType: 'instant',
    scheduleConfig: {},
  })

  const executed = await t.mutation(internal.workflows.executeScheduledWorkflow, {
    workflowId: workflow!._id,
  })
  vi.runAllTimers()
  await t.finishInProgressScheduledFunctions()
  const updated = await t.query(api.workflows.get, { id: workflow!._id })

  expect(executed).toEqual({ success: true })
  expect(updated).toMatchObject({
    isActive: true,
    status: 'pending',
    runsToday: 1,
  })
  expect(fetchMock).toHaveBeenCalledWith(
    'http://localhost:5000/api/workflows/run',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer secret-token',
      }),
    })
  )
})

test('resets daily runs for active workflows', async () => {
  const t = createConvexTest()
  await insertDoc(t, 'workflows', {
    name: 'Workflow C',
    description: 'daily reset',
    nodes: [],
    edges: [],
    listIds: [],
    status: 'idle',
    isActive: true,
    runsToday: 3,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })

  const result = await t.mutation(internal.workflows.resetDailyRuns, {})
  const rows = await t.query(api.workflows.list, {})

  expect(result).toEqual({ reset: 1 })
  expect(rows[0]?.runsToday).toBe(0)
})
