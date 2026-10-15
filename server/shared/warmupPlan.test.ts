import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyWarmupActivity, WarmupActivityBudget, warmupActivityPlan } from './warmupPlan.js'

test('maintenance limits interactions and uses time rather than Reel or Story ceilings', () => {
    for (const roll of [0, 0.999]) {
      const plan = warmupActivityPlan(8, () => roll)
      assert.ok(plan.likes >= 2 && plan.likes <= 6)
      assert.equal(plan.follows, 0)
      assert.ok(plan.profiles >= 1 && plan.profiles <= 4)
      assert.equal(plan.reels, 0)
      assert.equal(plan.stories, 0)
    }
})

test('activity budgets share remaining attempts across feed chunks and later sessions', () => {
  const plan = { likes: 0, profiles: 3, reels: 18, stories: 1 }
  const used = { ...emptyWarmupActivity(), profiles: 1 }
  const budget = new WarmupActivityBudget(plan, used)
  assert.equal(budget.take('likes'), false)
  assert.equal(budget.take('profiles'), true)
  assert.deepEqual(budget.delta(), { likes: 0, profiles: 1, reels: 0, stories: 0, follows: 0, saves: 0, comments: 0 })
  const nextSession = new WarmupActivityBudget(plan, budget.used)
  assert.equal(nextSession.take('likes'), false)
  assert.equal(nextSession.take('profiles'), true)
  assert.equal(nextSession.take('profiles'), false)
  assert.deepEqual(used, { likes: 0, profiles: 1, reels: 0, stories: 0, follows: 0, saves: 0, comments: 0 })
})

test('week-one ceilings match the requested like and follow ramp', () => {
  const ranges = [[0, 0, 0, 0], [2, 4, 0, 0], [3, 5, 2, 4], [3, 5, 4, 6], [4, 6, 5, 7], [4, 6, 6, 8], [4, 6, 8, 10]]
  for (const [index, [minLikes, maxLikes, minFollows, maxFollows]] of ranges.entries()) {
    for (const roll of [0, 0.999]) {
      const plan = warmupActivityPlan(index + 1, () => roll)
      assert.equal(plan.comments, index === 0 ? 0 : roll ? 3 : 1)
      assert.equal(plan.likes, roll ? maxLikes : minLikes)
      assert.equal(plan.follows, roll ? maxFollows : minFollows)
      assert.ok(index < 3 ? plan.stories === 0 : plan.stories <= 2)
    }
  }
})
