import { visibleActionGeometry } from './action-locator.test-support.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { engagePost, likePost, liveLikeSelector } from './engagement.js'
import { Window } from 'happy-dom'
import { BrowseSession, SessionEnded } from './session.js'
import { WarmupActivityBudget } from '../../shared/warmupPlan.js'

function likeFixture(options: { path?: string; alreadyLiked?: boolean; missing?: boolean; confirms?: boolean;
  failure?: Error; warning?: string; slowMovement?: () => void; lateLike?: 'during-hover' | 'before-live-click';
  related?: boolean; extras?: boolean; reelLikes?: number | null } = {}) {
  let liked = options.alreadyLiked ?? false, failed = false
  const calls: string[] = [], notes: Record<string, unknown>[] = []
  const makeControl = (label: string) => ({
    ...visibleActionGeometry, first() { return this },
    locator: (selector: string) => { assert.equal(selector, 'svg[aria-label="Like"]'); return makeControl('Like') },
    evaluate: async (fn: (node: Element) => unknown) => fn === liveLikeSelector
      ? 'svg[data-igbot-like-target=fixture][aria-label=Like]' : visibleActionGeometry.evaluate(fn),
    count: async () => label === 'Unlike' ? Number(liked) : Number(!options.missing),
    isVisible: async () => label === 'Unlike' ? liked : !liked && !options.missing,
    waitFor: async () => { if (!liked) throw new errors.TimeoutError('Like was not confirmed') },
    click: async (clickOptions: { human_config: { mouse_overshoot_chance: number } }) => {
      assert.equal(clickOptions.human_config.mouse_overshoot_chance, 0)
      if (options.lateLike === 'before-live-click') liked = true
      if (liked) throw new errors.TimeoutError('The live Like locator no longer matches')
      calls.push(label); liked = options.confirms !== false
    },
    elementHandle: async () => ({ ...visibleActionGeometry, dispose: async () => {},
      hover: async (hoverOptions: { human_config: { mouse_overshoot_chance: number } }) => {
        assert.equal(hoverOptions.human_config.mouse_overshoot_chance, 0)
        options.slowMovement?.()
        if (options.lateLike === 'during-hover') liked = true
        if (options.failure) { failed = true; throw options.failure }
      },
      click: async () => { throw new Error('Never click a pinned Like handle') },
    }),
  })
  const target = { evaluate: async (_fn: unknown, kind: string) => {
    assert.equal(kind, 'likes'); return options.reelLikes === undefined ? 3001 : options.reelLikes
  }, locator: (selector: string) => makeControl(selector.match(/aria-label="(\w+)"/)![1]!) } as unknown as Locator
  const page = { url: () => 'https://www.instagram.com' + (options.path ?? '/reels/current/'),
    viewportSize: () => ({ width: 1280, height: 800 }),
    mouse: { dblclick: async () => { throw new Error('Never double-click for engagement') } },
    locator: (selector: string) => selector === 'svg[data-igbot-like-target=fixture][aria-label=Like]' ? makeControl('Like')
      : selector === 'svg[data-igbot-like-target=fixture]' ? { evaluateAll: async () => {} }
        : { filter: () => ({ evaluateAll: async () => failed ? options.warning ?? null : null }) },
  } as unknown as Page
  const budget = new WarmupActivityBudget({ likes: 1, saves: options.extras ? 1 : 0,
    comments: options.extras ? 1 : 0, profiles: options.extras ? 1 : 0, reels: 0, stories: 0 })
  const session = new BrowseSession(Date.now() + 60_000)
  const run = async (roll = 0, likeOnly = false) => {
    const originalRandom = Math.random
    Math.random = () => roll
    try {
      await engagePost(page, target, { text: 'Dinner', relationship: 'followed' }, ['fitness'],
        budget, session, note => notes.push(note), async () => options.related !== false, undefined, likeOnly)
    } finally { Math.random = originalRandom }
  }
  return { run, calls, notes, budget, page, target, session, liked: () => liked }
}

test('lead Like input always clicks without a budget or random roll, and still skips already-liked content', async () => {
  const fixture = likeFixture(), originalRandom = Math.random
  Math.random = () => 0.999
  try {
    fixture.budget.used.likes = 500
    await likePost(fixture.page, fixture.target, undefined, fixture.session, () => {}, 100)
    await likePost(fixture.page, fixture.target, undefined, fixture.session, () => {}, 100)
    assert.deepEqual(fixture.calls, ['Like'])
    assert.equal(fixture.budget.used.likes, 500, 'lead outreach is independent of the browsing Like budget')
  } finally { Math.random = originalRandom }
})

test('a lead post identity change during cursor movement prevents Like input', async () => {
  const fixture = likeFixture()
  let checks = 0
  await assert.rejects(likePost(fixture.page, fixture.target, undefined, fixture.session, () => {}, 100, async () => {
    if (++checks === 2) throw new errors.TimeoutError('Lead post changed')
  }), /Lead post changed/)
  assert.deepEqual(fixture.calls, [])
})

for (const path of ['/', '/reels/current/', '/reel/current/']) test('likes use one live Like-button click on ' + path, async () => {
  const fixture = likeFixture({ path })
  await fixture.run()
  assert.deepEqual(fixture.calls, ['Like'])
  assert.equal(fixture.budget.used.likes, 1)
  assert.equal(fixture.notes[0]?.method, 'like_button')
  await fixture.run()
  assert.deepEqual(fixture.calls, ['Like'])
})

for (const related of [false, true]) for (const roll of [0.1, 0.3]) for (const reelLikes of [3000, 3001])
  test(`profile Reel engagement requires interest, Like chance and count (${related}, ${roll}, ${reelLikes})`, async () => {
    const fixture = likeFixture({ path: '/reel/current/', related, extras: true, reelLikes })
    const eligible = related && reelLikes > 3000
    await fixture.run(roll, true)
    assert.deepEqual(fixture.calls, eligible && roll < 0.3 ? ['Like'] : [])
    assert.equal(fixture.budget.used.saves + fixture.budget.used.comments + fixture.budget.used.profiles, 0)
    await fixture.run(0, true)
    assert.equal(fixture.budget.used.likes, eligible ? 1 : 0, 'profile Reels share the same daily Like cap')
  })

for (const path of ['/', '/reels/current/', '/reel/current/'])
  for (const roll of [0.299, 0.3, 0.999]) test(`30% Like chance on ${path} with roll ${roll}`, async () => {
    const fixture = likeFixture({ path })
    await fixture.run(roll)
    assert.deepEqual(fixture.calls, roll < 0.3 ? ['Like'] : [])
    assert.equal(fixture.budget.used.likes, roll < 0.3 ? 1 : 0)
    if (roll >= 0.3) {
      await fixture.run(0)
      assert.deepEqual(fixture.calls, ['Like'], 'a skipped Like must leave budget for the next match')
    }
  })

for (const path of ['/reels/current/', '/reel/current/']) for (const likes of [null, 0, 2999, 3000, 3001, 10_000])
  test(`Reel Likes require more than 3,000 visible likes (${path}, ${likes})`, async () => {
    const fixture = likeFixture({ path, reelLikes: likes })
    await fixture.run(0)
    const eligible = likes !== null && likes > 3000
    assert.deepEqual(fixture.calls, eligible ? ['Like'] : [])
    assert.equal(fixture.budget.used.likes, eligible ? 1 : 0)
  })

for (const alreadyLiked of [true, false]) test('liked or missing controls never receive input: ' + alreadyLiked, async () => {
  const fixture = likeFixture({ alreadyLiked, missing: !alreadyLiked })
  await fixture.run()
  assert.deepEqual(fixture.calls, [])
  assert.equal(fixture.budget.used.likes, 0)
})

for (const lateLike of ['during-hover', 'before-live-click'] as const)
  test('a late like is never undone: ' + lateLike, async () => {
    const fixture = likeFixture({ lateLike })
    await fixture.run()
    assert.deepEqual(fixture.calls, [])
    assert.equal(fixture.liked(), true)
  })

test('a six-second cursor movement still leaves time to click Like', async () => {
  const originalNow = Date.now
  let now = originalNow()
  Date.now = () => now
  try {
    const fixture = likeFixture({ slowMovement: () => { now += 6000 } })
    await fixture.run()
    assert.deepEqual(fixture.calls, ['Like'])
  } finally { Date.now = originalNow }
})

test('an expired click deadline prevents input after cursor movement', async () => {
  const originalNow = Date.now
  let now = originalNow()
  Date.now = () => now
  try {
    const fixture = likeFixture({ slowMovement: () => { now += 15_001 } })
    await fixture.run()
    assert.deepEqual(fixture.calls, [])
    assert.equal(fixture.notes[0]?.event, 'automation.engagement.action_skipped')
  } finally { Date.now = originalNow }
})

for (const failure of [new errors.TimeoutError('Moving timed out'), new Error('Element is not attached to the DOM')])
  test('an optional Like input failure is logged and browsing continues: ' + failure.name, async () => {
    const fixture = likeFixture({ failure })
    await fixture.run()
    assert.deepEqual(fixture.calls, [])
    assert.equal(fixture.notes[0]?.action, 'like')
    assert.equal(fixture.budget.used.likes, 1)
  })

test('an unconfirmed Like is not retried and does not end browsing', async () => {
  const fixture = likeFixture({ confirms: false })
  await fixture.run(); await fixture.run()
  assert.deepEqual(fixture.calls, ['Like'])
  assert.equal(fixture.notes[0]?.event, 'automation.engagement.action_skipped')
})

test('an optional Like still propagates account warnings and cancellation', async () => {
  await assert.rejects(likeFixture({ failure: new errors.TimeoutError('Moving timed out'), warning: 'limit' }).run(), /Instagram limit needs attention/)
  const cancelled = likeFixture({ failure: new SessionEnded('Browsing session ended') })
  await assert.rejects(cancelled.run(), SessionEnded)
  assert.equal(cancelled.notes.length, 0)
  await assert.rejects(likeFixture({ failure: new Error('Browser disconnected') }).run(), /Browser disconnected/)
  await assert.rejects(likeFixture({ failure: new Error('Unknown engine while parsing selector') }).run(), /Unknown engine/)
})

test('the live Like selector targets the heart inside a padded button and stops matching Unlike', async () => {
  const window = new Window()
  try {
    window.document.body.innerHTML = '<main><article><button><svg aria-label="Like"></svg></button></article>' +
      '<article><p>Caption</p><button style="width:80px;padding:20px"><svg aria-label="Like" width="24" height="24"></svg></button></article></main>'
    const selected = window.document.querySelectorAll('button')[1]!
    const selector = liveLikeSelector(selected as unknown as Element)
    assert.ok(!selector.includes('>>'))
    assert.equal(window.document.querySelector(selector), selected.querySelector('svg'))
    window.document.body.prepend(window.document.createElement('div'))
    selected.prepend(window.document.createElement('span'))
    assert.equal(window.document.querySelector(selector), selected.querySelector('svg'))
    selected.querySelector('svg')!.setAttribute('aria-label', 'Unlike')
    assert.equal(window.document.querySelectorAll(selector).length, 0)
    selected.remove()
    assert.throws(() => liveLikeSelector(selected as unknown as Element), /detached or missing/)
  } finally { await window.happyDOM.close() }
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

for (const related of [false, true]) for (const [path, likes, eligible] of [
  ['/', null, true], ['/reels/current/', null, false], ['/reels/current/', 1000, false], ['/reels/current/', 1001, true],
  ['/reel/current/', null, false], ['/reel/current/', 1000, false], ['/reel/current/', 1001, true],
] as const) test(`matched-author visits require interest, budget and Reel likes (${related}, ${path}, ${likes})`, async () => {
  const budget = new WarmupActivityBudget({ likes: 0, profiles: 1, reels: 0, stories: 0 })
  const page = { url: () => 'https://www.instagram.com' + path } as Page
  const target = { evaluate: async (_fn: unknown, kind: string) => {
    assert.notEqual(path, '/', 'Home feed author visits do not require a count')
    assert.equal(kind, 'likes'); return likes
  } } as unknown as Locator, session = new BrowseSession(Date.now() + 60_000)
  let visits = 0
  const visit = async (visitedPage: Page, visitedTarget: Locator) => {
    assert.equal(visitedPage, page); assert.equal(visitedTarget, target); visits++
  }
  for (let i = 0; i < 2; i++)
    await engagePost(page, target, { text: 'Fishing trip', relationship: 'followed' }, ['Fishing'], budget,
      session, () => {}, async () => related, visit)
  assert.equal(visits, related && eligible ? 1 : 0)
  assert.equal(budget.used.profiles, related && eligible ? 1 : 0)
})

for (const roll of [0.1, 0.3]) for (const [path, comments, eligible] of [
  ['/', null, true], ['/reels/current/', null, false], ['/reels/current/', 50, false], ['/reels/current/', 51, true],
  ['/reel/current/', null, false], ['/reel/current/', 50, false], ['/reel/current/', 51, true],
] as const) test(`engagement shares its cap and gates Reel comments independently of Like chance (${roll}, ${path}, ${comments})`, async () => {
  const originalRandom = Math.random
  Math.random = () => roll
  try {
    let liked = false, saved = false, commentsOpen = false
    const calls: string[] = []
    const makeControl = (label: string) => ({
      ...visibleActionGeometry,
      locator: () => makeControl(label),
      evaluate: async (fn: (node: Element) => unknown) => fn === liveLikeSelector
        ? 'svg[data-igbot-like-target=fixture][aria-label=Like]'
        : fn.toString().includes('data-igbot-action-target') ? `[data-igbot-action-target=fixture-${label}]` : visibleActionGeometry.evaluate(fn),
      evaluateAll: async () => {},
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
        if (label === 'Close') commentsOpen = false
      } }),
    })
    const target = { evaluate: async (_fn: unknown, kind: string) => {
      assert.notEqual(path, '/', 'Home feed comments do not require a count')
      if (kind === 'likes') return 3001
      assert.equal(kind, 'comments'); return comments
    }, locator: (selector: string) => {
      const label = selector.match(/aria-label="(\w+)"/)?.[1]
      assert.ok(label, 'only scoped post controls may be queried')
      return makeControl(label)
    } } as unknown as Locator
    const panel = { waitFor: async ({ state }: { state: string }) => { assert.equal(commentsOpen, state === 'visible') },
      isVisible: async () => commentsOpen, locator: () => makeControl('Close'),
      evaluate: async () => ({ left: 700, right: 1000, top: 200, bottom: 600, remaining: 1000, atEnd: false }) }
    const dialogs = { filter() { return this }, count: async () => Number(commentsOpen), last: () => panel }
    const page = {
      url: () => 'https://www.instagram.com' + path, viewportSize: () => ({ width: 1280, height: 800 }),
      locator: (selector: string) => selector === 'svg[data-igbot-like-target=fixture][aria-label=Like]' ? makeControl('Like')
        : selector === 'svg[data-igbot-like-target=fixture]' ? { evaluateAll: async () => {} }
          : selector.startsWith('[data-igbot-action-target=fixture-') ? makeControl(selector.match(/fixture-(\w+)/)![1]!)
          : ({ filter: () => ({ evaluateAll: async () => null }) }),
      getByRole: (role: string) => { assert.equal(role, 'dialog'); return dialogs },
      mouse: { move: async (x: number, y: number) => { assert.ok(x > 700 && x < 1000 && y > 200 && y < 600) },
        wheel: async (_x: number, y: number) => {
          assert.ok(commentsOpen); assert.ok(Number.isFinite(y) && y > 0); calls.push('scroll-comments')
        } },
      keyboard: { press: async () => { throw new Error('Close comments by clicking X') } },
    } as unknown as Page
    const session = new BrowseSession(Date.now() + 60_000); session.wait = async () => { session.check() }
    const budget = new WarmupActivityBudget({ likes: 2, saves: 1, comments: 1, profiles: 0, reels: 30, stories: 3 })
    const view = () => engagePost(page, target, { text: 'Dinner', relationship: 'followed' }, ['fitness'], budget, session, () => {}, async () => true)
    await view(); assert.equal(commentsOpen, false)
    assert.equal(calls.includes('Like'), roll < 0.3)
    assert.ok(calls.includes('Save'))
    for (const action of ['Comment', 'scroll-comments', 'Close']) assert.equal(calls.includes(action), eligible, action)
    await view(); assert.equal(budget.used.likes, roll < 0.3 ? 1 : 0, 'already-liked or chance-skipped posts must not consume another attempt')
    liked = false; await view()
    liked = false; await view()
    assert.equal(calls.filter(call => call === 'Like').length, roll < 0.3 ? 2 : 0)
    assert.equal(budget.used.likes, roll < 0.3 ? 2 : 0); assert.equal(budget.used.saves, 1); assert.equal(budget.used.comments, eligible ? 1 : 0)
  } finally { Math.random = originalRandom }
})
