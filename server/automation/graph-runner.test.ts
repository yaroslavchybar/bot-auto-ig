import { test } from 'node:test'
import assert from 'node:assert/strict'
import { executeGraphProfile } from './graph-runner.js'

test('pausing a graph profile stops before the next action and preserves its checkpoint for resume', async () => {
  let access = true
  const aggregateStates: Record<string, any> = {}
  const emitted: string[] = []
  const context: Parameters<typeof executeGraphProfile>[0] = {
    automationId: 'automation',
    profile: { id: 'profile', name: 'Model', inUse: false },
    session: {} as Parameters<typeof executeGraphProfile>[0]['session'],
    controls: { close: async () => {} },
    nodes: [
      { id: 'delay', data: { activityId: 'delay', config: { minSeconds: 60, maxSeconds: 60 } } },
      { id: 'after', type: 'start' },
    ],
    edges: [{ source: 'delay', target: 'after' }],
    repeat: false,
    aggregateStates,
    canContinue: () => access,
    log: () => {},
    emit: async (type) => {
      emitted.push(type)
      if (type === 'task_started') access = false
    },
  }
  // Start from the saved delay node, so the downstream start is not the entry point.
  aggregateStates.__profileRuns = {
    profile: { currentNodeId: 'delay', states: {}, completed: false },
  }
  await executeGraphProfile(context)
  assert.equal(aggregateStates.__profileRuns.profile.currentNodeId, 'delay')
  assert.equal(aggregateStates.__profileRuns.profile.completed, false)
  assert.equal(aggregateStates.__profileRuns.profile.states.after, undefined)
  assert.ok(!emitted.includes('task_completed'))
})
