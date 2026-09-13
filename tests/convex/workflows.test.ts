import { expect, test, vi } from 'vitest'

import { api, internal } from '../../convex/_generated/api'
import { createConvexTest, insertDoc, seedList, seedWorkflow } from './helpers'
import {
  getActivityById,
  getDefaultConfig,
  normalizeActivityConfig,
} from '../../frontend/src/features/workflows/activities'
import { validateWorkflowImport } from '../../frontend/src/features/workflows/utils/workflowImportExport'

test('workflow get returns null for malformed route ids', async () => {
  const t = createConvexTest()
  const workflow = await seedWorkflow(t, { name: 'Workflow Get Check' })
  expect(await t.query(api.workflows.queries.get, { id: String(workflow!._id) })).toMatchObject({
    name: 'Workflow Get Check',
  })
  expect(await t.query(api.workflows.queries.get, { id: 'not-a-workflow-id' })).toBeNull()
})

test('fresh runs clear completed profile state while pending runs keep checkpoints', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
  const t = createConvexTest()
  const nodeStates = { __profileRuns: { profile: { completed: true, states: {}, currentNodeId: null } } }
  const manual = await seedWorkflow(t, { status: 'completed', nodeStates })
  const started = await t.mutation(internal.workflows.mutations.startInternal, { id: manual!._id })
  expect(started?.nodeStates).toBeUndefined()
  const pending = await seedWorkflow(t, { status: 'pending', nodeStates })
  const resumed = await t.mutation(internal.workflows.mutations.startInternal, { id: pending!._id })
  expect(resumed?.nodeStates).toEqual(nodeStates)
  const scheduled = await seedWorkflow(t, { status: 'completed', isActive: true, nodeStates })
  await t.mutation(internal.workflows.scheduling.executeScheduledWorkflow, { workflowId: scheduled!._id })
  const scheduledDoc = await t.run(ctx => ctx.db.get(scheduled!._id))
  expect(scheduledDoc?.nodeStates).toBeUndefined()
  vi.runAllTimers()
  await t.finishInProgressScheduledFunctions()
})

test('creates workflows, deduplicates list ids, and transitions status', async () => {
  const t = createConvexTest()
  const list = await seedList(t, 'List A')

  const created = await t.mutation(api.workflows.mutations.create, {
    name: '  Workflow A  ',
    description: 'workflow',
    nodes: [],
    edges: [],
    listIds: [list!._id, list!._id],
  })
  const started = await t.mutation(internal.workflows.mutations.startInternal, { id: created!._id })
  const running = await t.mutation(internal.workflows.mutations.updateStatusInternal, {
    id: created!._id,
    status: 'running',
    currentNodeId: 'node-1',
    nodeStates: { 'node-1': 'running' },
  })
  const completed = await t.mutation(internal.workflows.mutations.updateStatusInternal, {
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

  const running = await t.mutation(internal.workflows.mutations.updateStatusInternal, {
    id: workflow!._id,
    status: 'running',
  })
  const paused = await t.mutation(internal.workflows.mutations.updateStatusInternal, {
    id: workflow!._id,
    status: 'paused',
  })
  const resumed = await t.mutation(internal.workflows.mutations.updateStatusInternal, {
    id: workflow!._id,
    status: 'running',
  })

  expect(running?.status).toBe('running')
  expect(paused?.status).toBe('paused')
  expect(resumed?.status).toBe('running')
})

test('executes recurring workflows through scheduler and mocked fetch boundaries', async () => {
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
    scheduleType: 'daily',
    scheduleConfig: {},
  })

  const executed = await t.mutation(internal.workflows.scheduling.executeScheduledWorkflow, {
    workflowId: workflow!._id,
  })
  vi.runAllTimers()
  await t.finishInProgressScheduledFunctions()
  const updated = await t.query(api.workflows.queries.get, { id: workflow!._id })

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

test('reads reset daily counters without a cron', async () => {
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

  const rows = await t.query(api.workflows.queries.list, {})

  expect(rows[0]?.runsToday).toBe(0)
})

test('deleting a scrape job keeps its scraped accounts for messaging', async () => {
  const t = createConvexTest()
  const job = await t.mutation(api.scrapeJobs.create, {
    name: 'Job Delete Keeps Accounts',
    targets: ['B1LbfVPlwIA'],
  })

  await t.mutation(internal.instagramAccounts.insertMany, {
    accounts: [{ userName: 'leaddelete', sourceJobId: job!._id }],
  })

  const removed = await t.mutation(api.scrapeJobs.remove, { id: job!._id })
  const accounts = await t.query(api.instagramAccounts.listScraped, {})

  expect(removed).toBe(true)
  expect(accounts.map((account) => account.userName)).toContain('leaddelete')
})

test('provides expanded default config for workflow activities', () => {
  const startBrowserDefaults = getDefaultConfig('start_browser')
  const sendDmDefaults = getDefaultConfig('send_dm')
  const browseFeedDefaults = getDefaultConfig('browse_feed')

  expect(startBrowserDefaults).toMatchObject({
    headlessMode: false,
    parallelProfiles: 1,
    profileReopenCooldownEnabled: false,
    profileReopenCooldownMinutes: 30,
    messagingCooldownEnabled: false,
    messagingCooldownHours: 2,
  })
  expect(sendDmDefaults).toMatchObject({
    template_kind: 'message',
    follow_if_no_message_button: true,
    typing_delay_min_ms: 100,
    typing_delay_max_ms: 200,
  })
  expect(browseFeedDefaults).toMatchObject({
    watch_stories: false,
    stories_min_view_seconds: 2,
    stories_max_view_seconds: 5,
    skip_post_chance: 30,
    post_view_min_seconds: 2,
    post_view_max_seconds: 5,
  })
})

test('preserves explicit start browser cooldown settings', () => {
  const normalized = normalizeActivityConfig('start_browser', {
    headlessMode: true,
    profileReopenCooldownEnabled: true,
    profileReopenCooldownMinutes: 45,
    messagingCooldownEnabled: true,
    messagingCooldownHours: 12,
  })

  expect(normalized).toMatchObject({
    headlessMode: true,
    parallelProfiles: 1,
    profileReopenCooldownEnabled: true,
    profileReopenCooldownMinutes: 45,
    messagingCooldownEnabled: true,
    messagingCooldownHours: 12,
  })
  expect(normalized).not.toHaveProperty('profileReopenCooldown')
  expect(normalized).not.toHaveProperty('messagingCooldown')
})

test('workflow import keeps expanded activity config payloads intact', () => {
  const result = validateWorkflowImport({
    fileName: 'workflow.json',
    fileSizeBytes: 1024,
    rawText: JSON.stringify({
      format: 'bot-auto-ig.workflow',
      version: '1.0',
      exportedAt: '2026-03-12T10:00:00.000Z',
      workflow: {
        name: 'Expanded Workflow',
        nodes: [
          { id: 'start_node', type: 'start', data: {} },
          {
            id: 'start_browser_1',
            type: 'activity',
            data: {
              activityId: 'start_browser',
              config: {
                parallelProfiles: 3,
                profileReopenCooldownEnabled: true,
                profileReopenCooldownMinutes: 90,
              },
            },
          },
          {
            id: 'send_dm_1',
            type: 'activity',
            data: {
              activityId: 'send_dm',
              config: {
                template_kind: 'message_2',
                typing_delay_min_ms: 120,
                typing_delay_max_ms: 240,
              },
            },
          },
        ],
        edges: [
          { id: 'e1', source: 'start_node', target: 'start_browser_1' },
          { id: 'e2', source: 'start_browser_1', target: 'send_dm_1' },
        ],
      },
    }),
    existingWorkflowNames: [],
    existingListIds: [],
    resolveActivityById: (activityId: string) => getActivityById(activityId),
  })

  const nodes = result.workflow.nodes as Array<Record<string, any>>
  expect(nodes[1]?.data?.config).toMatchObject({
    parallelProfiles: 3,
    profileReopenCooldownMinutes: 90,
  })
  expect(nodes[2]?.data?.config).toMatchObject({
    template_kind: 'message_2',
    typing_delay_min_ms: 120,
    typing_delay_max_ms: 240,
  })
})


test('manual and scheduled runs enforce the same daily limit and avoid duplicate reservations', async () => {
  const t = createConvexTest()
  const workflow = await seedWorkflow(t, { status: 'completed', isActive: true, maxRunsPerDay: 1, runsToday: 1, lastRunAt: Date.now() })
  await expect(t.mutation(internal.workflows.mutations.startInternal, { id: workflow!._id })).rejects.toThrow('Daily run limit')
  expect(await t.mutation(internal.workflows.scheduling.executeScheduledWorkflow, { workflowId: workflow!._id })).toMatchObject({ success: false })
  await t.run(ctx => ctx.db.patch(workflow!._id, { lastRunAt: Date.now() - 86400000 }))
  const started = await t.mutation(internal.workflows.mutations.startInternal, { id: workflow!._id })
  expect(started?.runsToday).toBe(1)
  expect(await t.mutation(internal.workflows.scheduling.executeScheduledWorkflow, { workflowId: workflow!._id })).toMatchObject({ success: false })
  expect((await t.run(ctx => ctx.db.get(workflow!._id)))?.runsToday).toBe(1)
})

test('instant workflows cannot become active schedules', async () => {
  const t = createConvexTest()
  const workflow = await seedWorkflow(t, { scheduleType: 'instant', scheduleConfig: {}, isActive: false })
  await expect(t.mutation(api.workflows.scheduling.toggleActive, { id: workflow!._id })).rejects.toThrow('Run now')
  expect((await t.run(ctx => ctx.db.get(workflow!._id)))?.isActive).toBe(false)
})


test('startup reconciliation preserves checkpoints and schedules while ending interrupted runs', async () => {
  const t = createConvexTest()
  const running = await seedWorkflow(t, { status: 'running', isActive: true, nodeStates: { saved: true } })
  const pending = await seedWorkflow(t, { status: 'pending' })
  expect(await t.mutation(internal.workflows.mutations.reconcileInterruptedInternal, {})).toEqual({ reconciled: 2 })
  expect(await t.run(ctx => ctx.db.get(running!._id))).toMatchObject({ status: 'failed', isActive: true, nodeStates: { saved: true } })
  expect((await t.run(ctx => ctx.db.get(pending!._id)))?.status).toBe('failed')
})
