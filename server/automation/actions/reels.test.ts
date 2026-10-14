import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { Window } from 'happy-dom'
import { errors } from 'playwright-core'
import { visibleActionGeometry } from './action-locator.test-support.js'
import { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { advanceReel, openReels, reelAdMarker, watchReels } from './reels.js'
import { BrowseSession, SessionEnded } from './session.js'

test('disabled reels never access the browser', async () => {
  await watchReels({} as Page, 5, { scroll_reels: false }, () => {}, () => false, Date.now() + 60_000)
})

for (const fixture of [
  { name: 'live Facebook ad redirect without an English CTA or label', current: '<a href="https://www.facebook.com/ads/ig_redirect/?d=example">Переглянути</a>', expected: 'ad_redirect' },
  { name: 'visible Ad label and CTA fallback', current: '<span>Ad</span><a href="https://example.com/">Learn more</a>', expected: 'ad_label_and_cta' },
  { name: 'Sponsored span paired with a native Learn more button', current: '<span>Sponsored</span><button>Learn more</button>', expected: 'ad_label_and_cta' },
  { name: 'Sponsored span paired with a button-role CTA', current: '<span>Sponsored</span><p role="button">Learn more</p>', expected: 'ad_label_and_cta' },
  { name: 'hidden Learn more button', current: '<span>Sponsored</span><button style="display:none">Learn more</button>', expected: null },
  { name: 'Learn more button in a neighboring Reel', current: '<span>Sponsored</span>', neighbor: '<button>Learn more</button>', expected: null },
  { name: 'preloaded neighboring ad even when its CTA overlaps the viewport', neighbor: '<span>Ad</span><a href="https://www.facebook.com/ads/ig_redirect/">Learn more</a>', expected: null },
  { name: 'Ad label and CTA belonging to different Reels', current: '<span>Ad</span>', neighbor: '<a>Learn more</a>', expected: null },
  { name: 'ordinary promotional CTA', current: '<a href="https://example.com/">Shop now</a>', expected: null },
  { name: 'lookalike ad link on another host', current: '<a href="https://facebook.com.example.com/ads/ig_redirect/">Visit website</a>', expected: null },
  { name: 'offscreen ad redirect', current: '<a data-offscreen href="https://www.facebook.com/ads/ig_redirect/">Learn more</a>', expected: null },
  { name: 'hidden ad redirect', current: '<a style="display:none" href="https://www.facebook.com/ads/ig_redirect/">Learn more</a>', expected: null },
]) test(`Reel ad detection: ${fixture.name}`, async () => {
  const window = new Window({ width: 1024, height: 600 })
  window.document.body.innerHTML = `<main><section>
    <div><video id="current"></video>${fixture.current ?? ''}</div>
    <div><video></video>${fixture.neighbor ?? ''}</div>
  </section></main>`
  for (const el of window.document.querySelectorAll('span, a, button, [role="button"]')) {
    const top = el.hasAttribute('data-offscreen') ? 700 : 100
    el.getBoundingClientRect = () => ({ width: 200, height: 48, top, bottom: top + 48, left: 200, right: 400 }) as DOMRect
  }
  try { assert.equal(reelAdMarker(window.document.querySelector('#current')! as unknown as Element), fixture.expected) }
  finally { await window.happyDOM.close() }
})

function reelAdvanceFixture(width: number, height: number, options: { nextVisible?: boolean; nextEnabled?: boolean; fixedViewport?: boolean; changeOnClick?: boolean;
  contextFailure?: Error; warningAfterFailure?: boolean; offTopic?: boolean; successiveReels?: boolean } = {}) {
  const window = new Window({ width, height })
  window.document.body.innerHTML = '<main><div style="overflow-y:auto;scroll-snap-type:y mandatory"><section><video id="previous"></video></section><section><video id="current"></video></section></div></main>'
  const panel = window.document.querySelector('main > div')!
  const step = height - 96
  Object.defineProperties(panel, { clientHeight: { value: step }, scrollHeight: { value: step * 3 } })
  panel.getBoundingClientRect = () => ({ left: 64, right: width - 32, top: 48, bottom: height - 48 }) as DOMRect
  const boxes = [
    { x: width * 0.25, y: -height * 0.65, width: width * 0.4, height },
    { x: width * 0.25, y: 16, width: width * 0.4, height: height - 32 },
  ]
  let contextFailed = false
  const videos = [...window.document.querySelectorAll('video')].map((node, i) => {
    node.getBoundingClientRect = () => ({ ...boxes[i], top: boxes[i].y, bottom: boxes[i].y + boxes[i].height,
      left: boxes[i].x, right: boxes[i].x + boxes[i].width }) as DOMRect
    return { boundingBox: async () => boxes[i], locator: () => ({}), evaluate: async <R>(fn: (el: Element) => R) => {
      assert.equal(node.id, 'current', 'the largest visible reel wins over the previous reel preview')
      if (fn.name === 'reelPostContext' && options.contextFailure) { contextFailed = true; throw options.contextFailure }
      if (fn.name === 'reelPostContext' && options.offTopic) return { text: 'An unrelated reel', relationship: 'not-followed' }
      return fn(node as unknown as Element)
    } }
  })
  let url = 'https://www.instagram.com/reels/current/', wheels = 0, clicks = 0, hovered = false
  const next = { ...visibleActionGeometry, filter() { return this }, first() { return this },
    isVisible: async () => options.nextVisible !== false, isEnabled: async () => options.nextEnabled !== false,
    elementHandle: async () => ({ ...visibleActionGeometry,
      hover: async () => { hovered = true },
      click: async () => { assert.ok(hovered); clicks++; if (options.changeOnClick !== false)
        url = `https://www.instagram.com/reels/next${options.successiveReels ? clicks : ''}/` },
      dispose: async () => {},
    }),
  }
  const page = { url: () => url, viewportSize: () => options.fixedViewport !== false ? { width, height } : null,
    evaluate: async (fn: () => unknown) => window.eval(`(${fn.toString()})()`),
    locator: (selector: string) => selector === 'video' ? { count: async () => videos.length, nth: (i: number) => videos[i] }
      : { filter: () => ({ evaluateAll: async () => options.warningAfterFailure && contextFailed ? 'limit' : null }) },
    getByRole: (role: string, options: { name: string; exact: boolean }) => {
      assert.equal(role, 'button'); assert.deepEqual(options, { name: 'Navigate to next Reel', exact: true })
      return next
    },
    waitForURL: async (matches: (url: URL) => boolean) => {
      if (!matches(new URL(url))) throw new errors.TimeoutError('Reel did not change')
    },
    mouse: { wheel: async () => { wheels++; throw new Error('Reels must advance only by button') } },
  } as unknown as Page
  const session = new BrowseSession(Date.now() + 60_000)
  session.wait = async () => { session.check() }
  return { window, page, session, boxes, navigate: (nextUrl: string) => { url = nextUrl }, stats: () => ({ wheels, clicks }) }
}

test('an already-open Reels viewer uses its visible frame without clicking the sidebar', async () => {
  const f = reelAdvanceFixture(1024, 600)
  const locator = f.page.locator.bind(f.page)
  f.page.locator = ((selector: string) => {
    assert.equal(selector, 'video', 'opening the current viewer must not select the sidebar')
    return locator(selector)
  }) as Page['locator']
  try {
    assert.equal(await openReels(f.page, () => {}, f.session), true)
    assert.equal(f.stats().clicks, 0)
  } finally { await f.window.happyDOM.close() }
})

test('a failed Reels sidebar click does not wait for navigation or retry the click', async () => {
  let clicks = 0, waits = 0
  const button = { filter() { return this }, first() { return this }, isVisible: async () => true,
    elementHandle: async () => { clicks++; return null } }
  const page = { url: () => 'https://www.instagram.com/alice/', locator: () => button,
    waitForURL: async () => { waits++ } } as unknown as Page
  const notes: Record<string, unknown>[] = []
  assert.equal(await openReels(page, note => notes.push(note)), false)
  assert.equal(clicks, 1)
  assert.equal(waits, 0)
  assert.equal(notes[0].stage, 'sidebar')
})

test('Reels opening shares a 15-second budget across navigation and settling', async () => {
  const f = reelAdvanceFixture(1024, 600), originalNow = Date.now
  let now = originalNow(), onReels = false
  Date.now = () => now
  const locator = f.page.locator.bind(f.page)
  const button = { ...visibleActionGeometry, filter() { return this }, first() { return this }, isVisible: async () => true,
    elementHandle: async () => ({ ...visibleActionGeometry, hover: async () => {}, click: async () => {}, dispose: async () => {} }) }
  f.page.url = () => onReels ? 'https://www.instagram.com/reels/current/' : 'https://www.instagram.com/alice/'
  f.page.locator = ((selector: string) => selector === 'video' ? locator(selector) : button) as Page['locator']
  f.page.waitForURL = async (_url, options) => { now += options!.timeout!; onReels = true }
  f.boxes[1].y = 330 // Navigation succeeds, but the frame never settles.
  f.session.wait = async ms => { now += ms; f.session.check() }
  const start = now, notes: Record<string, unknown>[] = []
  try {
    assert.equal(await openReels(f.page, note => notes.push(note), f.session), false)
    assert.equal(now - start, 15_000)
    assert.equal(notes[0].stage, 'settling')
  } finally { Date.now = originalNow; await f.window.happyDOM.close() }
})

for (const moved of [true, false]) test(`skipping a changing reel counts browsing progress only after verified advancement (${moved})`, async () => {
  const f = reelAdvanceFixture(1024, 600, { changeOnClick: moved, contextFailure: new Error('Element is not attached to the DOM') })
  const budget = new WarmupActivityBudget({ likes: 0, profiles: 0, reels: 1, stories: 0 })
  try {
    await watchReels(f.page, 1, {}, () => {}, () => false, f.session.end, f.session, budget)
    assert.equal(budget.browsed, moved ? 1 : 0)
    assert.equal(budget.used.reels, 0, 'skipping is progress but does not claim a watched reel')
  } finally { await f.window.happyDOM.close() }
})

test('off-topic reels can make browsing progress without any completed watches', async () => {
  const f = reelAdvanceFixture(1024, 600, { offTopic: true })
  const budget = new WarmupActivityBudget({ likes: 0, profiles: 0, reels: 1, stories: 0 })
  const notes: Record<string, unknown>[] = []
  try {
    await watchReels(f.page, 1, { warmup_topics: 'fitness', reels_skip_chance: 0 }, note => notes.push(note),
      () => false, f.session.end, f.session, budget, async () => false)
    assert.equal(budget.browsed, 1)
    assert.equal(budget.used.reels, 0)
    assert.ok(notes.some(note => note.event === 'automation.warmup.reel_off_topic'))
    assert.equal(notes.find(note => note.event === 'automation.reels_result')?.watchedCount, 0)
  } finally { await f.window.happyDOM.close() }
})

for (const ad of [false, true]) test(`off-topic Reels pause briefly before skipping while ads advance immediately (ad=${ad})`, async () => {
  const f = reelAdvanceFixture(1024, 600, { offTopic: true })
  const waits: number[] = [], decisions: number[] = []
  const budget = new WarmupActivityBudget({ likes: 1, profiles: 0, reels: 0, stories: 0 })
  if (ad) {
    const link = f.window.document.createElement('a')
    link.href = 'https://www.facebook.com/ads/ig_redirect/?d=example'
    link.innerText = 'Visit website'
    link.getBoundingClientRect = () => ({ width: 200, height: 48, top: 100, bottom: 148, left: 200, right: 400 }) as DOMRect
    f.window.document.querySelector('#current')!.parentElement!.append(link)
  }
  f.session.wait = async ms => { waits.push(ms); f.session.check() }
  try {
    await watchReels(f.page, 1, { warmup_topics: ['Fishing'] }, () => {}, () => f.stats().clicks >= 1,
      f.session.end, f.session, budget, async () => { decisions.push(1); return false })
    assert.equal(f.stats().clicks, 1)
    if (ad) assert.deepEqual(waits, [100], 'ads only wait for frame stability after advancing')
    else {
      assert.ok(waits[0] >= 500 && waits[0] <= 1200, 'off-topic decision pauses 0.5–1.2 seconds')
      assert.deepEqual(waits.slice(1), [100], 'no additional dwell beyond frame stability')
    }
    assert.equal(decisions.length, ad ? 0 : 1, 'ads skip before any AI request')
    assert.equal(budget.used.reels, 0); assert.equal(budget.used.likes, 0)
  } finally { await f.window.happyDOM.close() }
})

test('unlimited Reels continue past an old count cap and stop at the browsing deadline', async () => {
  const originalNow = Date.now, originalRandom = Math.random
  let now = originalNow()
  const start = now
  Date.now = () => now; Math.random = () => 0
  const f = reelAdvanceFixture(1024, 600, { successiveReels: true })
  for (const video of f.window.document.querySelectorAll('video')) Object.defineProperties(video, {
    duration: { value: 0 }, currentTime: { get: () => (now - start) / 1000 },
    paused: { value: false }, ended: { value: false },
  })
  const session = new BrowseSession(now + 25_000)
  session.wait = async ms => { now += Math.min(Math.max(1, Math.ceil(ms)), session.end - now); session.check() }
  const budget = new WarmupActivityBudget({ likes: 0, profiles: 0, reels: 1, stories: 0 })
  try {
    await assert.rejects(watchReels(f.page, Infinity, { reels_min: 1, reels_max: 1 }, () => {},
      () => false, session.end, session, budget), SessionEnded)
    assert.ok(budget.used.reels > 1, 'the old daily and min/max counts cannot stop viewing')
    assert.ok(f.stats().clicks > 1)
    assert.equal(now, session.end)
  } finally { Date.now = originalNow; Math.random = originalRandom; await f.window.happyDOM.close() }
})

test('a detached reel caption skips that reel instead of ending the session', async () => {
  const f = reelAdvanceFixture(1024, 600, { changeOnClick: false, contextFailure: new Error('Element is not attached to the DOM') })
  const notes: Record<string, unknown>[] = []
  try {
    await watchReels(f.page, 1, {}, note => notes.push(note), () => false, f.session.end, f.session)
    assert.equal(f.stats().clicks, 1, 'try the next reel after losing caption context')
    assert.ok(notes.some(note => note.event === 'automation.actions.reels.context_unavailable'))
  } finally { await f.window.happyDOM.close() }
})

test('reel caption recovery still stops on visible Instagram limits', async () => {
  const f = reelAdvanceFixture(1024, 600, { contextFailure: new errors.TimeoutError('Caption changed'), warningAfterFailure: true })
  try {
    await assert.rejects(watchReels(f.page, 1, {}, () => {}, () => false, f.session.end, f.session), /limit needs attention/)
    assert.equal(f.stats().clicks, 0)
  } finally { await f.window.happyDOM.close() }
})

for (const [width, height] of [[800, 480], [1024, 600], [1366, 768], [1920, 1080], [3840, 2160]])
  test(`Next-button reel advancement settles in a nested viewer at ${width}×${height}`, async () => {
    const fixture = reelAdvanceFixture(width, height)
    try {
      assert.equal(await advanceReel(fixture.page, fixture.session), true)
      assert.equal(fixture.stats().wheels, 0)
      assert.equal(fixture.stats().clicks, 1)
    } finally { await fixture.window.happyDOM.close() }
  })

test('reel advancement reads the real window size when Playwright has no fixed viewport', async () => {
  const fixture = reelAdvanceFixture(1024, 600, { fixedViewport: false })
  try { assert.equal(await advanceReel(fixture.page, fixture.session), true) }
  finally { await fixture.window.happyDOM.close() }
})

test('viewers without a native bridge retain the named Next button with cursor movement', async () => {
  const fixture = reelAdvanceFixture(1024, 600)
  try {
    assert.equal(await advanceReel(fixture.page, fixture.session), true)
    assert.equal(fixture.stats().clicks, 1)
    assert.equal(fixture.stats().wheels, 0)
  } finally { await fixture.window.happyDOM.close() }
})

for (const [width, height] of [[800, 480], [1024, 600], [1366, 768], [1920, 1080], [3840, 2160]])
  test(`native Reels advance with exactly one notch over visible media at ${width}×${height}`, async () => {
    const f = reelAdvanceFixture(width, height), before = f.page.url()
    const originalRandom = Math.random
    let coordinateRandom = 0
    Math.random = () => coordinateRandom++ % 2 === 0 ? 0.25 : 0.75
    let moved = false, notches = 0
    f.page.getByRole = (() => { throw new Error('Native wheel must not click Next') }) as Page['getByRole']
    f.page.mouse.move = async (x, y) => {
      assert.ok(x > f.boxes[1].x && x < f.boxes[1].x + f.boxes[1].width)
      assert.ok(y > 48 && y < height - 48, 'cursor stays inside the nested viewer')
      assert.notEqual(x, f.boxes[1].x + f.boxes[1].width / 2, 'cursor varies from the media center')
      moved = true
    }
    try {
      assert.equal(await advanceReel(f.page, f.session, () => {}, async (_x, _y, direction, timeout) => {
        assert.ok(moved, 'move the cursor before emitting the notch')
        assert.equal(direction, 'down'); assert.ok(timeout > 0 && timeout <= 5000)
        notches++
        f.navigate('https://www.instagram.com/reels/native-next/')
      }), true)
      assert.notEqual(f.page.url(), before)
      assert.equal(notches, 1)
      assert.deepEqual(f.stats(), { wheels: 0, clicks: 0 }, 'no pixel wheel events or clicks')
    } finally { Math.random = originalRandom; await f.window.happyDOM.close() }
  })

for (const failure of ['unchanged', 'transport', 'unsettled'])
  test(`native notch failure does not click Next or send another notch (${failure})`, async () => {
    const f = reelAdvanceFixture(1024, 600), notes: Record<string, unknown>[] = []
    let notches = 0
    f.page.mouse.move = async () => {}
    try {
      assert.equal(await advanceReel(f.page, f.session, note => notes.push(note), async () => {
        notches++
        if (failure === 'transport') throw new Error('Display session ended')
        if (failure === 'unsettled') {
          f.navigate('https://www.instagram.com/reels/native-next/')
          f.boxes[1].y = 330
        }
      }), false)
      assert.equal(notches, 1)
      assert.deepEqual(f.stats(), { wheels: 0, clicks: 0 })
      assert.equal(notes[0].stage, failure === 'transport' ? 'wheel' : failure === 'unsettled' ? 'settling' : 'navigation')
    } finally { await f.window.happyDOM.close() }
  })

test('session expiry during cursor movement prevents a native notch', async () => {
  const f = reelAdvanceFixture(1024, 600)
  let stopped = false, notches = 0
  f.session.stopped = () => stopped
  f.page.mouse.move = async () => { stopped = true }
  try {
    await assert.rejects(advanceReel(f.page, f.session, () => {}, async () => { notches++ }), SessionEnded)
    assert.equal(notches, 0)
    assert.deepEqual(f.stats(), { wheels: 0, clicks: 0 })
  } finally { await f.window.happyDOM.close() }
})

test('an unavailable Next button fails without wheel input or clicking', async () => {
  const fixture = reelAdvanceFixture(1024, 600, { nextVisible: false })
  try {
    assert.equal(await advanceReel(fixture.page, fixture.session), false)
    assert.equal(fixture.stats().clicks, 0)
    assert.equal(fixture.stats().wheels, 0)
  } finally { await fixture.window.happyDOM.close() }
})

test('a changed reel URL waits for the visible video to stop moving', async () => {
  const fixture = reelAdvanceFixture(1024, 600)
  fixture.boxes[1].y = 330
  let settlingWaits = 0
  fixture.session.wait = async () => {
    fixture.session.check()
    if (fixture.stats().clicks && ++settlingWaits === 2) fixture.boxes[1].y = 16
  }
  try {
    assert.equal(await advanceReel(fixture.page, fixture.session), true)
    assert.equal(settlingWaits, 3)
    assert.equal(fixture.stats().clicks, 1)
  } finally { await fixture.window.happyDOM.close() }
})

test('a changed reel URL alone is not successful advancement when the viewer never settles', async () => {
  const fixture = reelAdvanceFixture(1024, 600)
  fixture.boxes[1].y = 330
  try {
    assert.equal(await advanceReel(fixture.page, fixture.session), false)
    assert.equal(fixture.stats().clicks, 1)
  } finally { await fixture.window.happyDOM.close() }
})

test('a fully visible stable reel does not have to be centered in the viewport', async () => {
  const fixture = reelAdvanceFixture(1024, 600)
  fixture.boxes[0].y = -600
  fixture.boxes[1].height = 200
  fixture.boxes[1].y = 48
  try {
    assert.equal(await advanceReel(fixture.page, fixture.session), true)
    assert.equal(fixture.stats().clicks, 1)
  } finally { await fixture.window.happyDOM.close() }
})

test('a fully visible frame still waits for its motion to stop', async () => {
  const fixture = reelAdvanceFixture(1024, 600)
  fixture.boxes[0].y = -600
  fixture.boxes[1].height = 200
  fixture.boxes[1].y = 48
  let waits = 0
  fixture.session.wait = async () => { if (++waits < 3) fixture.boxes[1].y += 10 }
  try {
    assert.equal(await advanceReel(fixture.page, fixture.session), true)
    assert.equal(waits, 3)
  } finally { await fixture.window.happyDOM.close() }
})

test('advancement logs whether navigation failed instead of swallowing the error', async () => {
  const fixture = reelAdvanceFixture(1024, 600, { changeOnClick: false })
  const notes: Record<string, unknown>[] = []
  try {
    assert.equal(await advanceReel(fixture.page, fixture.session, note => notes.push(note)), false)
    assert.equal(notes.length, 1)
    assert.equal(notes[0].event, 'automation.actions.reels.advance_failed')
    assert.equal(notes[0].stage, 'navigation')
    assert.ok(notes[0].error instanceof errors.TimeoutError)
  } finally { await fixture.window.happyDOM.close() }
})

test('expiry while a reel is settling propagates instead of reporting stuck navigation', async () => {
  const fixture = reelAdvanceFixture(1024, 600)
  const notes: Record<string, unknown>[] = []
  let expired = false
  fixture.session.wait = async () => { expired = true; throw new SessionEnded('Browsing session ended') }
  fixture.session.stopped = () => expired
  try {
    await assert.rejects(advanceReel(fixture.page, fixture.session, note => notes.push(note)), SessionEnded)
    assert.equal(notes.length, 0)
  } finally { await fixture.window.happyDOM.close() }
})

test('a stopped session does not click Next or emit wheel input', async () => {
  const fixture = reelAdvanceFixture(1024, 600)
  const session = new BrowseSession(Date.now() + 60_000, () => true)
  try {
    await assert.rejects(advanceReel(fixture.page, session), SessionEnded)
    assert.equal(fixture.stats().wheels, 0)
    assert.equal(fixture.stats().clicks, 0)
  } finally { await fixture.window.happyDOM.close() }
})

for (const options of [{ nextEnabled: false }, { changeOnClick: false }])
  test('a disabled Next button or unchanged URL is not successful advancement: ' + JSON.stringify(options), async () => {
    const fixture = reelAdvanceFixture(1024, 600, options)
    try {
      assert.equal(await advanceReel(fixture.page, fixture.session), false)
      assert.equal(fixture.stats().wheels, 0)
      assert.equal(fixture.stats().clicks, options.nextEnabled === false ? 0 : 1)
    } finally { await fixture.window.happyDOM.close() }
  })

for (const followed of [false, true]) test(followed
  ? 'followed Reels receive interest checks despite old 100% random skip settings'
  : 'reels stay passive even with previously active settings and unused like allowance', async () => {
  const window = new Window(), originalNow = Date.now
  let now = originalNow()
  const start = now
  Date.now = () => now
  try {
    window.document.body.innerHTML = `<main><section><div id="current-reel"><div><a href="/author/reels/">author</a>${followed ? '' : '<button>Follow</button>'}</div>
      <video></video><p>Barbell squats and progressive overload</p></div>
      <div><video></video><p>Neighboring reel caption</p></div></section></main>`
    for (const control of window.document.querySelectorAll('button'))
      Object.defineProperty(control, 'getBoundingClientRect', { value: () => ({ width: 50, height: 20 }) })
    const video = window.document.querySelector('video')!
    Object.defineProperties(video, {
      duration: { value: 0 }, currentTime: { get: () => (now - start) / 1000 },
      paused: { value: false }, ended: { value: false },
    })
    const post = { evaluate: async (read: (element: Element) => unknown) => read(video.parentElement!) }
    const target = {
      locator: (selector: string) => {
        assert.equal(selector, 'xpath=ancestor::*[ancestor::main][count(.//video)=1][last()]')
        return post
      },
      boundingBox: async () => ({ x: 200, y: 0, width: 500, height: 600 }),
      evaluate: async (fn: (element: Element) => unknown) => fn(video as unknown as Element),
    }
    const videos = { count: async () => 1, nth: () => target }
    const page = { url: () => 'https://www.instagram.com/reels/current/',
      viewportSize: () => ({ width: 1280, height: 800 }), evaluate: async () => false,
      locator: (selector: string) => {
        if (selector === 'video') return videos
        assert.equal(selector, '[role="dialog"], [role="alertdialog"], [role="alert"]')
        return { filter: () => ({ evaluateAll: async () => null }) }
      },
    } as unknown as Page
    const session = new BrowseSession(now + 60_000)
    session.wait = async ms => { now += Math.max(1, Math.ceil(ms)); session.check() }
    const budget = new WarmupActivityBudget({ likes: 6, profiles: 2, reels: 0, stories: 0 })
    let decisions = 0
    await watchReels(page, 1, { soft_warmup: false, warmup_topics: 'fitness', like_chance: 100, reels_skip_chance: followed ? 100 : 0 },
      () => {}, () => false, session.end, session, budget, async (context, _topics, _session, _log, screenshotTarget) => {
        decisions++
        assert.equal(screenshotTarget, post, 'topic screenshot must include the reel frame and its caption')
        await post.evaluate(node => {
          assert.equal(node.querySelectorAll('video').length, 1)
          assert.match(node.textContent ?? '', /Barbell squats/)
          assert.doesNotMatch(node.textContent ?? '', /Neighboring reel caption/)
        })
        assert.match(context.text, /Barbell squats/)
        return true
      })
    assert.equal(decisions, 1)
    assert.equal(budget.used.likes, 0)
    assert.equal(budget.used.reels, 1)
    assert.ok(now - start >= 6000)
  } finally { Date.now = originalNow; await window.happyDOM.close() }
})
