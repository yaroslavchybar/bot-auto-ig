import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { engageWeekOne } from './week-one.js'
import { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { BrowseSession } from './session.js'

function setup(bio = 'Fitness coach', caption = 'Fitness workout', authorize = true, candidates = ['/self/', '/trainer/']) {
  let url = 'https://www.instagram.com/', followed = false
  const calls: string[] = []
  const control = { filter() { return this }, first() { return this }, isVisible: async () => true,
    waitFor: async () => {}, click: async () => {}, fill: async () => {}, dispose: async () => {},
    elementHandle: async () => control }
  const page = {
    url: () => url,
    goto: async (value: string) => { url = value; followed = false; calls.push('visit') },
    locator: (selector: string) => {
      if (selector.includes('[role="alert"]')) return { filter: () => ({ evaluateAll: async () => null }) }
      if (selector === 'main a[href]') return { evaluateAll: async () => candidates }
      if (selector === 'main header') return { ...control, innerText: async () => bio }
      if (selector.startsWith('xpath=')) return { ...control,
        isVisible: async () => selector.includes('="follow"') && !followed,
        click: async () => { followed = true; calls.push('follow') } }
      return control
    },
    getByRole: (role: string) => role === 'dialog'
      ? { getByRole: () => ({ innerText: async () => caption }) } : control,
  } as unknown as Page
  const deps: NonNullable<Parameters<typeof engageWeekOne>[6]> = {
    follow: async (_page, allowed, click, confirmed) => { if (!await allowed()) return false; await click(); await confirmed(); return true },
    pauseFollows: async () => {},
    ownUsername: async () => 'self',
    beginFollow: async () => { calls.push('authorize'); return authorize },
    confirmFollow: async () => { calls.push('confirm-follow') },
    like: async (_page, allowed, beforeLike) => {
      await allowed()
      if (!await beforeLike!()) return false
      calls.push('like'); return true
    },
  }
  const budget = new WarmupActivityBudget({ likes: 2, follows: 2, profiles: 2, reels: 18, stories: 0 })
  const session = new BrowseSession(Date.now() + 60_000)
  session.wait = async () => { session.check() }
  const run = (topics = 'fitness', interlude?: () => Promise<boolean>) => engageWeekOne(page, topics, budget, session,
    { profileId: 'profile', runId: 'run', date: '2026-10-12' }, () => {}, deps, interlude)
  return { calls, budget, run }
}

test('week-one actions verify the profile and post topic and authorize before following', async () => {
  const s = setup(); await s.run()
  assert.deepEqual(s.calls, ['visit', 'like', 'authorize', 'follow', 'confirm-follow'])
  assert.equal(s.budget.used.likes, 1); assert.equal(s.budget.used.follows, 1)
  assert.equal(s.budget.used.profiles, 1)
})

test('search results without matching profile evidence are never engaged', async () => {
  const s = setup('Cooking'); await s.run()
  assert.deepEqual(s.calls, ['visit'])
  assert.equal(s.budget.used.likes, 0); assert.equal(s.budget.used.follows, 0)
  assert.equal(s.budget.used.profiles, 1)
})

test('an off-topic post is not liked or counted even on a topic-related account', async () => {
  const s = setup('Fitness coach', 'Dinner'); await s.run()
  assert.ok(!s.calls.includes('like')); assert.equal(s.budget.used.likes, 0)
  assert.ok(s.calls.includes('follow'))
})

test('refused follow authorization never clicks Follow or consumes the local budget', async () => {
  const s = setup('Fitness coach', 'Dinner', false); await s.run()
  assert.deepEqual(s.calls, ['visit', 'authorize']); assert.equal(s.budget.used.follows, 0)
})

test('blank keywords cause no browser access or engagement', async () => {
  const s = setup(); await s.run('')
  assert.deepEqual(s.calls, [])
})

test('an exhausted shared profile budget causes no browser access or engagement', async () => {
  const s = setup()
  s.budget.take('profiles'); s.budget.take('profiles')
  await s.run()
  assert.deepEqual(s.calls, [])
})

test('off-topic candidates consume only the remaining shared profile allowance', async () => {
  const s = setup('Cooking', 'Dinner', true, ['/trainer_one/', '/trainer_two/', '/trainer_three/'])
  s.budget.take('profiles') // A previous browsing chunk used one visit.
  await s.run()
  assert.deepEqual(s.calls, ['visit'])
  assert.equal(s.budget.used.profiles, 2)
})

test('the browsing interlude can exhaust the shared profile budget before the next visit', async () => {
  const s = setup('Fitness coach', 'Dinner', true, ['/trainer_one/', '/trainer_two/'])
  await s.run('fitness', async () => { s.budget.take('profiles'); return true })
  assert.equal(s.calls.filter(call => call === 'visit').length, 1)
  assert.equal(s.calls.filter(call => call === 'follow').length, 1)
  assert.equal(s.budget.used.profiles, 2)
})

test('week-one follows require a browsing interlude before the next account', async () => {
  for (const canBrowse of [false, true]) {
    const s = setup('Fitness coach', 'Dinner', true, ['/trainer_one/', '/trainer_two/'])
    await s.run('fitness', async () => { s.calls.push('browse'); return canBrowse })
    assert.equal(s.calls.filter(call => call === 'follow').length, canBrowse ? 2 : 1)
    const first = s.calls.indexOf('confirm-follow')
    assert.equal(s.calls[first + 1], 'browse')
  }
})
