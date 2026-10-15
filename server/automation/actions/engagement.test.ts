import { visibleActionGeometry } from './action-locator.test-support.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { engagePost, liveLikeSelector } from './engagement.js'
import { Window } from 'happy-dom'
import { UnsupportedHumanizeSelectorError } from 'cloakbrowser/human'
import { BrowseSession, SessionEnded } from './session.js'
import { WarmupActivityBudget } from '../../shared/warmupPlan.js'

function likeFixture(options: { doubleTapLikes?: boolean; failure?: Error; warning?: string; slowMovement?: () => void;
  native?: boolean; covered?: boolean; navigated?: boolean; nativeFailure?: Error;
  missingSurface?: boolean; videoBox?: { x: number; y: number; width: number; height: number };
  lateLike?: 'after-confirmation' | 'during-hover' | 'before-live-click' } = {}) {
  let liked = false, failed = false, confirmationExpired = false
  let hovered = false
  let reels = false
  const calls: string[] = [], notes: Record<string, unknown>[] = []
  const makeControl = (label: string) => ({
    ...visibleActionGeometry, first() { return this },
    evaluate: async (fn: (node: Element) => unknown) => fn === liveLikeSelector
      ? 'button:has(svg[aria-label="Like"])' : visibleActionGeometry.evaluate(fn),
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
      evaluate: async (fn: (node: unknown, point: unknown) => unknown, point: unknown) => {
        const node = { isConnected: true, parentElement: null, contains: (hit: unknown) => hit === node,
          ownerDocument: { defaultView: { innerWidth: 1280, innerHeight: 800 },
            elementFromPoint: () => options.covered ? {} : node } }
        return fn(node, point)
      },
      hover: async () => {
        hovered = true
        options.slowMovement?.()
        if ((label === 'Like' || options.native) && options.lateLike === 'during-hover') liked = true
        if (options.failure) { failed = true; throw options.failure }
      },
      click: async () => { calls.push(label); liked = true },
      dblclick: async () => { calls.push('double-tap'); liked = options.doubleTapLikes === true },
    }),
  })
  const videoBox = options.videoBox ?? { x: 100, y: 100, width: 40, height: 40 }
  const target = { locator: (selector: string) => selector === 'video'
    ? { first() { return this }, boundingBox: async () => videoBox }
    : makeControl(selector.match(/aria-label="(\w+)"/)![1]!) } as unknown as Locator
  const surface = makeControl('video') as unknown as Locator
  const point = { x: (Math.max(0, 100, videoBox.x) + Math.min(1280, 140, videoBox.x + videoBox.width)) / 2,
    y: (Math.max(0, 100, videoBox.y) + Math.min(800, 140, videoBox.y + videoBox.height)) / 2 }
  const page = { url: () => reels ? `https://www.instagram.com/reels/${hovered && options.navigated ? 'next' : 'current'}/` : 'https://www.instagram.com/',
    mouse: { move: async (x: number, y: number) => {
      assert.deepEqual({ x, y }, point)
      hovered = true
      options.slowMovement?.()
      if (options.lateLike === 'during-hover') liked = true
      if (options.failure) { failed = true; throw options.failure }
    }, dblclick: async (x: number, y: number, options_: { button: string }) => {
      assert.equal(hovered, true); assert.deepEqual({ x, y }, point); assert.equal(options_.button, 'left')
      calls.push('double-tap'); liked = options.doubleTapLikes === true
    } },
    viewportSize: () => ({ width: 1280, height: 800 }),
    locator: (selector: string) => selector === 'button:has(svg[aria-label="Like"])' ? makeControl('Like') : ({ filter: () => ({ evaluateAll: async () => {
      if (confirmationExpired && options.lateLike === 'after-confirmation') liked = true
      return failed ? options.warning ?? null : null
    } }) }),
  } as unknown as Page
  const budget = new WarmupActivityBudget({ likes: 1, saves: 0, comments: 0, profiles: 0, reels: 1, stories: 0 })
  const session = new BrowseSession(Date.now() + 60_000)
  const run = (doubleTap = false) => { reels = doubleTap; return engagePost(page, target, { text: 'Dinner', relationship: 'followed' }, ['fitness'],
    budget, session, note => notes.push(note), async () => true, doubleTap && !options.missingSurface ? surface : undefined, undefined,
    options.native ? async (x, y, timeout) => {
      assert.equal(hovered, true, 'Cloak must move before native input')
      assert.deepEqual({ x, y }, point)
      assert.ok(timeout > 0 && timeout <= 15_000)
      if (options.nativeFailure) throw options.nativeFailure
      calls.push('native-double-tap'); liked = options.doubleTapLikes === true
    } : undefined) }
  return { run, calls, notes, budget, session, liked: () => liked }
}

for (const doubleTapLikes of [true, false]) test(`native Reel double-tap never falls back to the Like button (${doubleTapLikes})`, async () => {
  const fixture = likeFixture({ native: true, doubleTapLikes })
  await fixture.run(true)
  assert.deepEqual(fixture.calls, ['native-double-tap'])
  assert.equal(fixture.budget.used.likes, 1)
  if (doubleTapLikes) assert.equal(fixture.notes[0]?.method, 'native_double_tap')
  if (!doubleTapLikes) assert.equal(fixture.notes[0]?.reason, 'like_not_confirmed')
  await fixture.run(true)
  assert.equal(fixture.calls.length, 1)
})

test('native double-tap never clicks a Reel that became liked during hover', async () => {
  const fixture = likeFixture({ native: true, lateLike: 'during-hover' })
  await fixture.run(true)
  assert.deepEqual(fixture.calls, [])
  assert.equal(fixture.liked(), true)
})

for (const obstruction of ['covered', 'navigated'] as const) test(`native double-tap skips a ${obstruction} Reel`, async () => {
  const fixture = likeFixture({ native: true, [obstruction]: true })
  await fixture.run(true)
  assert.deepEqual(fixture.calls, [])
  assert.equal(fixture.notes[0]?.event, 'automation.engagement.action_skipped')
})

test('uncertain native double-tap input is never retried with a Like click', async () => {
  const fixture = likeFixture({ native: true, nativeFailure: new Error('Desktop pointer timed out') })
  await assert.rejects(fixture.run(true), /Desktop pointer timed out/)
  assert.deepEqual(fixture.calls, [])
})

for (const lateLike of ['after-confirmation', 'during-hover', 'before-live-click'] as const)
  test(`a late double-tap like never receives a Like-button click (${lateLike})`, async () => {
    const originalRandom = Math.random
    Math.random = () => 0
    try {
      const fixture = likeFixture({ lateLike })
      await fixture.run(true)
      assert.deepEqual(fixture.calls, lateLike === 'during-hover' ? [] : ['double-tap'])
      assert.equal(fixture.liked(), lateLike !== 'before-live-click')
      assert.equal(fixture.budget.used.likes, 1)
    } finally { Math.random = originalRandom }
  })

for (const doubleTapLikes of [true, false]) test(`Reels double-tap confirms or skips without a button click (${doubleTapLikes})`, async () => {
  const originalRandom = Math.random
  Math.random = () => 0
  try {
    const fixture = likeFixture({ doubleTapLikes })
    await fixture.run(true)
    assert.deepEqual(fixture.calls, ['double-tap'])
    assert.equal(fixture.budget.used.likes, 1, 'both input methods share one attempt')
    await fixture.run(true)
    assert.equal(fixture.calls.length, 1, 'never double-tap an already-liked reel')
  } finally { Math.random = originalRandom }
})

test('Home feed keeps its single Like click even when double-tap is supported', async () => {
  const originalRandom = Math.random
  Math.random = () => 0
  try {
    const fixture = likeFixture({ doubleTapLikes: true, native: true })
    await fixture.run()
    assert.deepEqual(fixture.calls, ['Like'])
  } finally { Math.random = originalRandom }
})

test('a missing Reels player never falls back to its Like button', async () => {
  const fixture = likeFixture({ missingSurface: true, native: true })
  await fixture.run(true)
  assert.deepEqual(fixture.calls, [])
  assert.equal(fixture.budget.used.likes, 0)
  assert.equal(fixture.notes[0]?.reason, 'video_player_unavailable')
})

for (const native of [false, true]) test(`Reel double-clicks stay inside the video even when its player is larger (native=${native})`, async () => {
  const fixture = likeFixture({ native, doubleTapLikes: true, videoBox: { x: 125, y: 130, width: 100, height: 150 } })
  await fixture.run(true)
  assert.deepEqual(fixture.calls, [native ? 'native-double-tap' : 'double-tap'])
})

test('a video outside its player cannot receive a double-click', async () => {
  const fixture = likeFixture({ native: true, videoBox: { x: 300, y: 300, width: 100, height: 150 } })
  await fixture.run(true)
  assert.deepEqual(fixture.calls, [])
  assert.equal(fixture.notes[0]?.event, 'automation.engagement.action_skipped')
})

test('an unsupported optional engagement selector is logged without ending browsing', async () => {
  const fixture = likeFixture({ failure: new UnsupportedHumanizeSelectorError('chained >> Like') })
  await fixture.run()
  assert.deepEqual(fixture.calls, [])
  assert.equal(fixture.notes[0]?.action, 'like')
})

test('the Home Like selector is one CSS path and stops matching after the button becomes Unlike', async () => {
  const window = new Window()
  try {
    window.document.body.innerHTML = '<main><article><button><svg aria-label="Like"></svg></button></article>' +
      '<article><p>Caption</p><button><svg aria-label="Like"></svg></button></article></main>'
    const selected = window.document.querySelectorAll('button')[1]!
    const selector = liveLikeSelector(selected as unknown as Element)
    assert.ok(!selector.includes('>>'))
    assert.equal(window.document.querySelector(selector), selected)
    selected.querySelector('svg')!.setAttribute('aria-label', 'Unlike')
    assert.equal(window.document.querySelectorAll(selector).length, 0)
    selected.remove()
    assert.throws(() => liveLikeSelector(selected as unknown as Element), /detached or missing/)
  } finally { await window.happyDOM.close() }
})

for (const native of [false, true]) test(`a six-second cursor movement has time to complete the Reels double-tap (native=${native})`, async () => {
  const originalRandom = Math.random, originalNow = Date.now
  let now = originalNow()
  Math.random = () => 0; Date.now = () => now
  try {
    const fixture = likeFixture({ native, doubleTapLikes: true, slowMovement: () => { now += 6000 } })
    await fixture.run(true)
    assert.deepEqual(fixture.calls, [native ? 'native-double-tap' : 'double-tap'])
    assert.equal(fixture.notes[0]?.event, 'automation.engagement.liked')
  } finally { Math.random = originalRandom; Date.now = originalNow }
})

test('native double-tap cannot start after cursor movement exhausts its action deadline', async () => {
  const originalNow = Date.now
  let now = originalNow()
  Date.now = () => now
  try {
    const fixture = likeFixture({ native: true, slowMovement: () => { now += 15_001 } })
    await fixture.run(true)
    assert.deepEqual(fixture.calls, [])
    assert.equal(fixture.notes[0]?.event, 'automation.engagement.action_skipped')
  } finally { Date.now = originalNow }
})

test('a temporary Like failure is logged and does not end browsing or refund its attempt', async () => {
  const originalRandom = Math.random
  Math.random = () => 0
  try {
    const fixture = likeFixture({ failure: new errors.TimeoutError('Click timed out while moving to its target') })
    await fixture.run(true)
    assert.equal(fixture.notes[0]?.event, 'automation.engagement.action_skipped')
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

test('engagement never engages any author without selected interests', async () => {
  const budget = new WarmupActivityBudget({ likes: 6, saves: 1, comments: 1, profiles: 4, reels: 30, stories: 3 })
  for (const relationship of ['not-followed', 'unknown', 'followed'] as const)
    await engagePost({} as Page, {} as Locator, { text: 'Dinner', relationship }, [], budget,
      new BrowseSession(Date.now() + 60_000), () => {})
  assert.equal(budget.used.likes + budget.used.saves + budget.used.comments, 0)
})

test('a negative interest decision blocks every interaction, including followed authors', async () => {
  const budget = new WarmupActivityBudget({ likes: 6, saves: 1, comments: 1, profiles: 4, reels: 0, stories: 0 })
  let decisions = 0
  for (const relationship of ['not-followed', 'unknown', 'followed'] as const)
    await engagePost({} as Page, {} as Locator, { text: 'Dinner #fitness', relationship }, ['fitness'], budget,
      new BrowseSession(Date.now() + 60_000), () => {}, async () => { decisions++; return false })
  assert.equal(decisions, 3)
  assert.equal(budget.used.likes + budget.used.saves + budget.used.comments, 0)
})

for (const related of [false, true]) test(`matched-author visits share interest evidence and the daily cap (${related})`, async () => {
  const budget = new WarmupActivityBudget({ likes: 0, profiles: 1, reels: 0, stories: 0 })
  const page = { url: () => 'https://www.instagram.com/reels/current/' } as Page
  const target = {} as Locator, session = new BrowseSession(Date.now() + 60_000)
  let visits = 0
  const visit = async (visitedPage: Page, visitedTarget: Locator) => {
    assert.equal(visitedPage, page); assert.equal(visitedTarget, target); visits++
  }
  for (let i = 0; i < 2; i++)
    await engagePost(page, target, { text: 'Fishing trip', relationship: 'followed' }, ['Fishing'], budget,
      session, () => {}, async () => related, undefined, visit)
  assert.equal(visits, related ? 1 : 0)
  assert.equal(budget.used.profiles, related ? 1 : 0)
})

test('engagement pins the post controls, shares its cap, and reads comments without composing', async () => {
  const originalRandom = Math.random
  Math.random = () => 0.999
  try {
    let liked = false, saved = false, commentsOpen = false
    const calls: string[] = []
    const makeControl = (label: string) => ({
      ...visibleActionGeometry,
      evaluate: async (fn: (node: Element) => unknown) => fn === liveLikeSelector
        ? 'button:has(svg[aria-label="Like"])' : visibleActionGeometry.evaluate(fn),
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
      locator: (selector: string) => selector === 'button:has(svg[aria-label="Like"])' ? makeControl('Like')
        : ({ filter: () => ({ evaluateAll: async () => null }) }),
      getByRole: (role: string) => { assert.equal(role, 'dialog'); return dialogs },
      mouse: { move: async () => {}, wheel: async () => { calls.push('scroll-comments') } },
      keyboard: { press: async (key: string) => { assert.equal(key, 'Escape'); commentsOpen = false } },
    } as unknown as Page
    const session = new BrowseSession(Date.now() + 60_000); session.wait = async () => { session.check() }
    const budget = new WarmupActivityBudget({ likes: 2, saves: 1, comments: 1, profiles: 0, reels: 30, stories: 3 })
    const view = () => engagePost(page, target, { text: 'Dinner', relationship: 'followed' }, ['fitness'], budget, session, () => {}, async () => true)
    await view(); assert.equal(commentsOpen, false)
    assert.ok(calls.includes('Like') && calls.includes('Save') && calls.includes('Comment') && calls.includes('scroll-comments'))
    await view(); assert.equal(budget.used.likes, 1, 'already-liked posts must not consume another attempt')
    liked = false; await view()
    liked = false; await view()
    assert.equal(calls.filter(call => call === 'Like').length, 2)
    assert.equal(budget.used.likes, 2); assert.equal(budget.used.saves, 1); assert.equal(budget.used.comments, 1)
  } finally { Math.random = originalRandom }
})
