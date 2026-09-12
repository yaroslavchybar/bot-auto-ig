import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  advanceLoop,
  nextNode,
  selectedLists,
  profileEligible,
} from './graph.js'

test('a branch never falls through to the opposite output', () => {
  const nodes = [{ id: 'condition' }, { id: 'wrong' }, { id: 'right' }]
  const edges = [
    { source: 'condition', target: 'wrong', sourceHandle: 'false' },
  ]
  assert.equal(nextNode(nodes, edges, nodes[0], 'true'), undefined)
  assert.equal(nextNode(nodes, edges, nodes[0], 'false')?.id, 'wrong')
  edges.push({ source: 'condition', target: 'right', sourceHandle: 'true' })
  assert.equal(nextNode(nodes, edges, nodes[0], 'true')?.id, 'right')
})

test('loops finish after N visits and can run again inside an outer loop', () => {
  const state = { runs: 0 }
  assert.deepEqual(
    Array.from({ length: 8 }, () => advanceLoop(state, 3)),
    ['loop', 'loop', 'loop', 'done', 'loop', 'loop', 'loop', 'done'],
  )
})

test('selected lists restrict eligible profiles and enforce cooldown', () => {
  const lists = selectedLists([
    {
      id: 'lists',
      data: { activityId: 'select_list', config: { sourceLists: ['chosen'] } },
    },
  ])
  const profile = { Using: false, login: true, list_ids: ['chosen'] }
  assert.equal(profileEligible(profile, lists), true)
  assert.equal(
    profileEligible({ ...profile, list_ids: ['other'] }, lists),
    false,
  )
  assert.equal(profileEligible({ ...profile, Using: true }, lists), false)
  assert.equal(
    profileEligible(
      { ...profile, last_opened_at: new Date().toISOString() },
      lists,
      30,
    ),
    false,
  )
})
