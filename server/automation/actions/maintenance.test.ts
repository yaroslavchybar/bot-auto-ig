import { visibleActionGeometry } from './action-locator.test-support.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright-core'
import { maintainPost } from './maintenance.js'
import { BrowseSession } from './session.js'
import { WarmupActivityBudget } from '../../shared/warmupPlan.js'

test('maintenance never touches unrelated or unknown authors with blank keywords', async () => {
  const budget = new WarmupActivityBudget({ likes: 6, saves: 1, comments: 1, profiles: 4, reels: 30, stories: 3 })
  for (const relationship of ['not-followed', 'unknown'] as const)
    await maintainPost({} as Page, {} as Locator, { text: 'Dinner', relationship }, [], budget,
      new BrowseSession(Date.now() + 60_000), () => {})
  assert.equal(budget.used.likes + budget.used.saves + budget.used.comments, 0)
})

test('maintenance pins the post controls, shares its cap, and reads comments without composing', async () => {
  const originalRandom = Math.random
  Math.random = () => 0
  try {
    let liked = false, saved = false, commentsOpen = false
    const calls: string[] = []
    const makeControl = (label: string) => ({
      ...visibleActionGeometry,
      first() { return this }, count: async () => label === 'Unlike' ? Number(liked) : 1,
      isVisible: async () => label === 'Save' ? !saved : true,
      boundingBox: async () => ({ x: 100, y: 100, width: 30, height: 30 }),
      waitFor: async () => { if (label === 'Unlike') assert.ok(liked) },
      elementHandle: async () => ({ ...visibleActionGeometry, hover: async () => {}, dispose: async () => {}, click: async () => {
        calls.push(label)
        if (label === 'Like') liked = true
        if (label === 'Save') saved = true
        if (label === 'Comment') commentsOpen = true
      } }),
    })
    const target = { locator: (selector: string) => {
      const label = selector.match(/aria-label="(\w+)"/)?.[1]
      assert.ok(label, 'only scoped post controls may be queried')
      return makeControl(label)
    } } as unknown as Locator
    const panel = { waitFor: async () => { assert.ok(commentsOpen) }, boundingBox: async () => ({ x: 100, y: 100, width: 300, height: 400 }) }
    const dialogs = { filter() { return this }, count: async () => Number(commentsOpen), last: () => panel }
    const page = {
      url: () => 'https://www.instagram.com/', viewportSize: () => ({ width: 1280, height: 800 }),
      locator: () => ({ filter: () => ({ evaluateAll: async () => null }) }),
      getByRole: (role: string) => { assert.equal(role, 'dialog'); return dialogs },
      mouse: { move: async () => {}, wheel: async () => { calls.push('scroll-comments') } },
      keyboard: { press: async (key: string) => { assert.equal(key, 'Escape'); commentsOpen = false } },
    } as unknown as Page
    const session = new BrowseSession(Date.now() + 60_000); session.wait = async () => { session.check() }
    const budget = new WarmupActivityBudget({ likes: 2, saves: 1, comments: 1, profiles: 4, reels: 30, stories: 3 })
    const view = () => maintainPost(page, target, { text: 'Dinner', relationship: 'followed' }, [], budget, session, () => {})
    await view(); assert.equal(commentsOpen, false)
    assert.ok(calls.includes('Like') && calls.includes('Save') && calls.includes('Comment') && calls.includes('scroll-comments'))
    await view(); assert.equal(budget.used.likes, 1, 'already-liked posts must not consume another attempt')
    liked = false; await view()
    liked = false; await view()
    assert.equal(calls.filter(call => call === 'Like').length, 2)
    assert.equal(budget.used.likes, 2); assert.equal(budget.used.saves, 1); assert.equal(budget.used.comments, 1)
  } finally { Math.random = originalRandom }
})
