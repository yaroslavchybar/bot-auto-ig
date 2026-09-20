import { expect, test, vi } from 'vitest'

import { api, internal } from '../../convex/_generated/api'
import { createConvexTest, insertDoc, seedList, seedAutomation } from './helpers'
import {
  getActivityById,
  getDefaultConfig,
} from '../../frontend/src/features/automations/activities'
import {
  getDefaultStartConfig,
  normalizeStartConfig,
} from '../../frontend/src/features/automations/startNode'
import { validateAutomationImport } from '../../frontend/src/features/automations/utils/automationImportExport'
import { selectedLists } from '../../server/automation/graph'

test('editor saves preserve source list selections for reopening and execution', async () => {
  const t = createConvexTest()
  const list = await seedList(t)
  const automation = await seedAutomation(t)
  const nodes = [{
    id: 'start_node',
    type: 'start',
    data: { config: { sourceLists: [list!._id] } },
  }]

  await t.mutation(api.automations.mutations.update, {
    id: automation!._id,
    nodes,
    edges: [],
  })
  const reopened = await t.query(api.automations.queries.get, { id: automation!._id })
  expect(normalizeStartConfig(reopened!.nodes[0].data.config).sourceLists).toEqual([list!._id])
  expect(selectedLists(reopened!.nodes)).toEqual([list!._id])

  nodes[0].data.config.sourceLists = []
  await t.mutation(api.automations.mutations.update, { id: automation!._id, nodes })
  const cleared = await t.query(api.automations.queries.get, { id: automation!._id })
  expect(selectedLists(cleared!.nodes)).toEqual([])
})

test('automation get returns null for malformed route ids', async () => {
  const t = createConvexTest()
  const automation = await seedAutomation(t, { name: 'Automation Get Check' })
  expect(await t.query(api.automations.queries.get, { id: String(automation!._id) })).toMatchObject({
    name: 'Automation Get Check',
  })
  expect(await t.query(api.automations.queries.get, { id: 'not-a-automation-id' })).toBeNull()
})

test('fresh runs clear completed profile state while pending runs keep checkpoints', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
  const t = createConvexTest()
  const nodeStates = { __profileRuns: { profile: { completed: true, states: {}, currentNodeId: null } } }
  const manual = await seedAutomation(t, { status: 'completed', nodeStates })
  const started = await t.mutation(internal.automations.mutations.startInternal, { id: manual!._id })
  expect(started?.nodeStates).toBeUndefined()
  const pending = await seedAutomation(t, { status: 'pending', nodeStates })
  const resumed = await t.mutation(internal.automations.mutations.startInternal, { id: pending!._id })
  expect(resumed?.nodeStates).toEqual(nodeStates)
  const rerun = await seedAutomation(t, { status: 'completed', isActive: true, nodeStates })
  await t.mutation(internal.automations.mutations.startInternal, { id: rerun!._id })
  const rerunDoc = await t.run(ctx => ctx.db.get(rerun!._id))
  expect(rerunDoc?.nodeStates).toBeUndefined()
  vi.runAllTimers()
  await t.finishInProgressScheduledFunctions()
})

test('creates automations, deduplicates list ids, and transitions status', async () => {
  const t = createConvexTest()
  const list = await seedList(t, 'List A')

  const created = await t.mutation(api.automations.mutations.create, {
    name: '  Automation A  ',
    description: 'automation',
    nodes: [],
    edges: [],
    listIds: [list!._id, list!._id],
  })
  expect(created?.isActive).toBe(false)
  await t.mutation(api.automations.mutations.setActive, { id: created!._id, isActive: true })
  const started = await t.mutation(internal.automations.mutations.startInternal, { id: created!._id })
  const running = await t.mutation(internal.automations.mutations.updateStatusInternal, {
    id: created!._id,
    status: 'running',
    currentNodeId: 'node-1',
    nodeStates: { 'node-1': 'running' },
  })
  const completed = await t.mutation(internal.automations.mutations.updateStatusInternal, {
    id: created!._id,
    status: 'completed',
  })

  expect(created).toMatchObject({
    name: 'Automation A',
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
    nodes: [],
    edges: [],
    listIds: [],
    status: 'idle',
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })

  const rows = await t.query(api.automations.queries.list, {})

  expect(rows[0]).toMatchObject({ name: 'Automation C', isActive: true })
  expect(rows[0]).not.toHaveProperty('runsToday')
})

test('provides default config for the start node', () => {
  expect(getDefaultStartConfig()).toMatchObject({
    sourceLists: [],
    headlessMode: false,
    profileReopenCooldownEnabled: false,
    profileReopenCooldownMinutes: 30,
  })
  expect(normalizeStartConfig({ headlessMode: true })).toMatchObject({
    headlessMode: true,
    profileReopenCooldownMinutes: 30,
  })

  const browseFeedDefaults = getDefaultConfig('browse_feed')
  expect(browseFeedDefaults).toMatchObject({
    watch_stories: false,
    stories_min_view_seconds: 2,
    stories_max_view_seconds: 5,
    skip_post_chance: 30,
    post_view_min_seconds: 2,
    post_view_max_seconds: 5,
  })
})

test('preserves explicit start node cooldown settings', () => {
  const normalized = normalizeStartConfig({
    headlessMode: true,
    profileReopenCooldownEnabled: true,
    profileReopenCooldownMinutes: 45,
  })

  expect(normalized).toMatchObject({
    headlessMode: true,
    profileReopenCooldownEnabled: true,
    profileReopenCooldownMinutes: 45,
  })
  expect(normalized).not.toHaveProperty('profileReopenCooldown')
})

test('automation import keeps start node config payloads intact', () => {
  const result = validateAutomationImport({
    fileName: 'automation.json',
    fileSizeBytes: 1024,
    rawText: JSON.stringify({
      format: 'bot-auto-ig.automation',
      version: '1.0',
      exportedAt: '2026-03-12T10:00:00.000Z',
      automation: {
        name: 'Expanded Automation',
        nodes: [
          {
            id: 'start_node',
            type: 'start',
            data: {
              config: {
                sourceLists: [],
                headlessMode: true,
                profileReopenCooldownEnabled: true,
                profileReopenCooldownMinutes: 90,
              },
            },
          },
        ],
        edges: [],
      },
    }),
    existingAutomationNames: [],
    existingListIds: [],
    resolveActivityById: (activityId: string) => getActivityById(activityId),
    singletonActivityIds: ['browse_feed'],
  })

  const nodes = result.automation.nodes as Array<Record<string, any>>
  expect(nodes[0]?.data?.config).toMatchObject({
    headlessMode: true,
    profileReopenCooldownMinutes: 90,
  })
})


test('automation import rejects a second warm up block', () => {
  const feedNode = (id: string) => ({
    id,
    type: 'activity',
    data: { activityId: 'browse_feed', config: {} },
  })
  const rawText = JSON.stringify({
    format: 'bot-auto-ig.automation',
    version: '1.0',
    exportedAt: '2026-03-12T10:00:00.000Z',
    automation: {
      name: 'Double Warm Up',
      nodes: [
        { id: 'start_node', type: 'start', data: { config: {} } },
        feedNode('warm-1'),
        feedNode('warm-2'),
      ],
      edges: [],
    },
  })
  const input = {
    fileName: 'automation.json',
    fileSizeBytes: 1024,
    rawText,
    existingAutomationNames: [] as string[],
    existingListIds: [] as string[],
    resolveActivityById: (activityId: string) => getActivityById(activityId),
    singletonActivityIds: ['browse_feed'],
  }
  expect(() => validateAutomationImport(input)).toThrow('Only one block allowed')

  const single = JSON.parse(rawText)
  single.automation.nodes.pop()
  expect(() => validateAutomationImport({ ...input, rawText: JSON.stringify(single) })).not.toThrow()
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
    name: 'Automation D',
    nodes: [],
    edges: [],
  })
  expect(created?.isActive).toBe(false)
})


test('startup reconciliation preserves checkpoints while ending interrupted runs', async () => {
  const t = createConvexTest()
  const running = await seedAutomation(t, { status: 'running', isActive: true, nodeStates: { saved: true } })
  const pending = await seedAutomation(t, { status: 'pending' })
  expect(await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, {})).toEqual({ reconciled: 2 })
  expect(await t.run(ctx => ctx.db.get(running!._id))).toMatchObject({ status: 'failed', isActive: true, nodeStates: { saved: true } })
  expect((await t.run(ctx => ctx.db.get(pending!._id)))?.status).toBe('failed')
})
