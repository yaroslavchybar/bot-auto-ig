import { expect, test, vi } from 'vitest'

import { api, internal } from '../../convex/_generated/api'
import { createConvexTest, insertDoc, seedList, seedWorkflow } from './helpers'
import {
  getActivityById,
  getDefaultConfig,
  normalizeActivityConfig,
} from '../../frontend/src/features/workflows/activities'
import { validateWorkflowImport } from '../../frontend/src/features/workflows/utils/workflowImportExport'

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

test('deleting a workflow also removes its stored artifacts', async () => {
  const t = createConvexTest()
  const workflow = await seedWorkflow(t, { name: 'Workflow Delete Cascade' })
  const stored = await t.action(internal.workflowArtifacts.storeArtifactInternal, {
    payload: {
      storageKind: 'export',
      users: [{ userName: 'user-delete' }],
    },
  })

  const artifact = await t.mutation(api.workflowArtifacts.upsert, {
    workflowId: workflow!._id,
    workflowName: workflow!.name,
    nodeId: 'node-delete-cascade',
    kind: 'followers',
    targets: ['target-delete'],
    storageId: stored.storageId,
    exportStorageId: stored.storageId,
  })

  const removed = await t.mutation(api.workflows.remove, { id: workflow!._id })
  const artifactAfterDelete = await t.query(api.workflowArtifacts.getById, {
    id: artifact!._id,
  })
  const storageUrl = await t.query(api.workflowArtifacts.getStorageUrl, {
    storageId: stored.storageId,
  })

  expect(removed).toBe(true)
  expect(artifactAfterDelete).toBeNull()
  expect(storageUrl).toBeNull()
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

test('normalizes legacy start browser cooldown keys into the new workflow shape', () => {
  const normalized = normalizeActivityConfig('start_browser', {
    headlessMode: true,
    profileReopenCooldown: 45,
    messagingCooldown: 12,
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
