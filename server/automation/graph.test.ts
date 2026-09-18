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
      id: 'start_node',
      type: 'start',
      data: { config: { sourceLists: ['chosen'] } },
    },
  ])
  const profile = { using: false, login: true, listIds: ['chosen'] }
  assert.equal(profileEligible(profile, lists), true)
  assert.equal(
    profileEligible({ ...profile, listIds: ['other'] }, lists),
    false,
  )
  assert.equal(profileEligible({ ...profile, using: true }, lists), false)
  assert.equal(
    profileEligible(
      { ...profile, lastOpenedAt: Date.now() },
      lists,
      30,
    ),
    false,
  )
})
