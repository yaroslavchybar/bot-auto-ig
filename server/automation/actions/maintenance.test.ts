import { visibleActionGeometry } from './action-locator.test-support.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { maintainPost } from './maintenance.js'
import { BrowseSession, SessionEnded } from './session.js'
import { WarmupActivityBudget } from '../../shared/warmupPlan.js'

function likeFixture(options: { doubleTapLikes?: boolean; failure?: Error; warning?: string; slowMovement?: () => void;
  lateLike?: 'after-confirmation' | 'during-hover' | 'before-live-click' } = {}) {
  let liked = false, failed = false, confirmationExpired = false
  const calls: string[] = [], notes: Record<string, unknown>[] = []
  const makeControl = (label: string) => ({
    ...visibleActionGeometry, first() { return this },
    count: async () => label === 'Unlike' ? Number(liked) : 1,
    isVisible: async () => label === 'Unlike' ? liked : options.lateLike === 'after-confirmation' || !liked,
    waitFor: async () => { if (!liked) { confirmationExpired = true; throw new errors.TimeoutError('Like was not confirmed') } },
    click: async () => {
      if (options.lateLike === 'before-live-click') liked = true
      if (liked) throw new errors.TimeoutError('The live Like locator no longer matches')
      calls.push(label); liked = true
    },
    elementHandle: async () => ({
      ...visibleActionGeometry, dispose: async () => {},
      hover: async () => {
        options.slowMovement?.()
        if (label === 'Like' && options.lateLike === 'during-hover') liked = true
        if (options.failure) { failed = true; throw options.failure }
      },
      click: async () => { calls.push(label); liked = true },
      dblclick: async () => { calls.push('double-tap'); liked = options.doubleTapLikes === true },
    }),
  })
  const target = { locator: (selector: string) => makeControl(selector.match(/aria-label="(\w+)"/)![1]!) } as unknown as Locator
  const surface = makeControl('video') as unknown as Locator
  const page = { url: () => 'https://www.instagram.com/reels/current/',
    viewportSize: () => ({ width: 1280, height: 800 }),
    locator: () => ({ filter: () => ({ evaluateAll: async () => {
      if (confirmationExpired && options.lateLike === 'after-confirmation') liked = true
      return failed ? options.warning ?? null : null
    } }) }),
  } as unknown as Page
  const budget = new WarmupActivityBudget({ likes: 1, saves: 0, comments: 0, profiles: 0, reels: 1, stories: 0 })
  const session = new BrowseSession(Date.now() + 60_000)
  const run = (doubleTap = false) => maintainPost(page, target, { text: 'Dinner', relationship: 'followed' }, [],
    budget, session, note => notes.push(note), undefined, doubleTap ? surface : undefined)
  return { run, calls, notes, budget, session, liked: () => liked }
}

for (const lateLike of ['after-confirmation', 'during-hover', 'before-live-click'] as const)
  test(`a late double-tap like is never undone (${lateLike})`, async () => {
    const originalRandom = Math.random
    Math.random = () => 0
    try {
      const fixture = likeFixture({ lateLike })
      await fixture.run(true)
      assert.deepEqual(fixture.calls, ['double-tap'])
      assert.equal(fixture.liked(), true)
      assert.equal(fixture.budget.used.likes, 1)
    } finally { Math.random = originalRandom }
  })

for (const doubleTapLikes of [true, false]) test(`Reels double-tap confirms the like or falls back once (${doubleTapLikes})`, async () => {
  const originalRandom = Math.random
  Math.random = () => 0
  try {
    const fixture = likeFixture({ doubleTapLikes })
    await fixture.run(true)
    assert.deepEqual(fixture.calls, doubleTapLikes ? ['double-tap'] : ['double-tap', 'Like'])
    assert.equal(fixture.budget.used.likes, 1, 'both input methods share one attempt')
    await fixture.run(true)
    assert.equal(fixture.calls.length, doubleTapLikes ? 1 : 2, 'never double-tap an already-liked reel')
  } finally { Math.random = originalRandom }
})

test('Home feed keeps its single Like click even when double-tap is supported', async () => {
  const originalRandom = Math.random
  Math.random = () => 0
  try {
    const fixture = likeFixture({ doubleTapLikes: true })
    await fixture.run()
    assert.deepEqual(fixture.calls, ['Like'])
  } finally { Math.random = originalRandom }
})

test('a six-second cursor movement has time to complete the Reels double-tap', async () => {
  const originalRandom = Math.random, originalNow = Date.now
  let now = originalNow()
  Math.random = () => 0; Date.now = () => now
  try {
    const fixture = likeFixture({ doubleTapLikes: true, slowMovement: () => { now += 6000 } })
    await fixture.run(true)
    assert.deepEqual(fixture.calls, ['double-tap'])
    assert.equal(fixture.notes[0]?.event, 'automation.maintenance.liked')
  } finally { Math.random = originalRandom; Date.now = originalNow }
})

test('a temporary Like failure is logged and does not end browsing or refund its attempt', async () => {
  const originalRandom = Math.random
  Math.random = () => 0
  try {
    const fixture = likeFixture({ failure: new errors.TimeoutError('Click timed out while moving to its target') })
    await fixture.run(true)
    assert.equal(fixture.notes[0]?.event, 'automation.maintenance.action_skipped')
    assert.equal(fixture.notes[0]?.action, 'like')
    assert.equal(fixture.budget.used.likes, 1)
    assert.deepEqual(fixture.calls, [])
  } finally { Math.random = originalRandom }
})

test('an optional Like timeout still propagates Instagram account warnings', async () => {
  const originalRandom = Math.random
  Math.random = () => 0
  try {
    const fixture = likeFixture({ failure: new errors.TimeoutError('Moving timed out'), warning: 'limit' })
    await assert.rejects(fixture.run(true), /Instagram limit needs attention/)
  } finally { Math.random = originalRandom }
})

test('an optional Like still stops when its session expires', async () => {
  const originalRandom = Math.random
  Math.random = () => 0
  try {
    const fixture = likeFixture({ failure: new SessionEnded('Browsing session ended') })
    await assert.rejects(fixture.run(true), SessionEnded)
    assert.equal(fixture.notes.length, 0)
  } finally { Math.random = originalRandom }
})

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
      isVisible: async () => label === 'Unlike' ? liked : label === 'Save' ? !saved : true,
      boundingBox: async () => ({ x: 100, y: 100, width: 30, height: 30 }),
      waitFor: async () => { if (label === 'Unlike') assert.ok(liked) },
      click: async () => { assert.equal(label, 'Like'); calls.push(label); liked = true },
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
