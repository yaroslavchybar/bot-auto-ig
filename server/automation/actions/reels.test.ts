import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright-core'
import { Window } from 'happy-dom'
import { errors } from 'playwright-core'
import { visibleActionGeometry } from './action-locator.test-support.js'
import { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { advanceReel, enableReelSound, openReels, reelAdMarker, watchReels } from './reels.js'
import { BrowseSession, SessionEnded } from './session.js'
import { liveLikeSelector } from './engagement.js'
import { reelEngagementCount } from './reel-counts.js'

test('disabled reels never access the browser', async () => {
  await watchReels({} as Page, new BrowseSession(Date.now() + 60_000, () => false), { scroll_reels: false }, () => {})
})

for (const mode of ['muted', 'unmuted', 'missing', 'timeout', 'probe-timeout', 'disconnected'] as const)
  test('Reel sound targets only the current muted video: ' + mode, async () => {
    const window = new Window()
    window.document.body.innerHTML = '<main><section id="current"><video></video><button><svg aria-label="Audio is muted"></svg></button></section>' +
      '<section id="neighbor"><video></video><button><svg aria-label="Audio is muted"></svg></button></section></main>'
    const current = window.document.querySelector('#current')!, video = current.querySelector('video')!
    video.muted = mode !== 'unmuted'
    if (mode === 'missing') current.querySelector('button')!.remove()
    const notes: Record<string, unknown>[] = []
    let clicks = 0
    type Node = typeof current | null
    const locator = (resolve: () => Node): Locator => ({
      ...visibleActionGeometry, first() { return this },
      evaluate: async (fn: (element: Element) => unknown) => fn(resolve() as unknown as Element),
      evaluateAll: async (fn: (nodes: Element[]) => unknown) => fn(resolve() ? [resolve() as unknown as Element] : []),
      locator: (selector: string) => locator(() => resolve()?.querySelector(selector) ?? null),
      isVisible: async () => !!resolve(),
      waitFor: async ({ state }: { state: string }) => { assert.equal(!!resolve(), state !== 'hidden') },
      hover: async () => {}, click: async () => {
        assert.ok(current.contains(resolve())); clicks++
        if (mode === 'timeout') throw new errors.TimeoutError('Sound toggle timed out')
        if (mode === 'disconnected') throw new Error('Browser disconnected')
        video.muted = false; resolve()!.setAttribute('aria-label', 'Audio is playing')
      },
    }) as unknown as Locator
    const media = { evaluate: async (fn: (element: Element) => unknown) => {
      if (mode === 'probe-timeout') throw new errors.TimeoutError('Sound state unavailable during navigation')
      return fn(video as unknown as Element)
    },
      locator: () => locator(() => current) } as unknown as Locator
    const page = { url: () => 'https://www.instagram.com/reels/current/',
      locator: (selector: string) => selector.startsWith('[data-igbot-action-target=') ? locator(() => window.document.querySelector(selector))
        : { filter: () => ({ evaluateAll: async () => null }) },
    } as unknown as Page
    try {
      const run = enableReelSound(page, media, new BrowseSession(Date.now() + 60_000), note => notes.push(note))
      if (mode === 'disconnected') await assert.rejects(run, /Browser disconnected/)
      else await run
      assert.equal(clicks, mode === 'unmuted' || mode === 'missing' || mode === 'probe-timeout' ? 0 : 1)
      assert.equal(window.document.querySelector('#neighbor svg')!.getAttribute('aria-label'), 'Audio is muted')
      if (mode === 'muted') assert.equal(notes[0]?.event, 'automation.actions.reels.sound_enabled')
      if (mode === 'timeout' || mode === 'probe-timeout') assert.equal(notes[0]?.event, 'automation.actions.reels.sound_unavailable')
    } finally { await window.happyDOM.close() }
  })

for (const player of ['sibling', 'ancestor', 'missing'] as const)
  test(`matched Reel likes click only its own Like button with a ${player} player`, async () => {
    const window = new Window(), originalNow = Date.now, originalRandom = Math.random
    let now = originalNow(), doubleTaps = 0, buttonClicks = 0
    const started = now
    Date.now = () => now
    Math.random = () => 0.1
    const overlay = '<div role="group" aria-label="Video player"></div>'
    const videoHtml = player === 'ancestor' ? '<div role="group" aria-label="Video player"><video></video></div>'
      : `<video></video>${player === 'sibling' ? overlay : ''}`
    window.document.body.innerHTML = `<main><div id="current-reel">${videoHtml}
      <div><button><svg aria-label="Like"></svg></button><span>3,001</span></div></div>
      <div id="neighbor"><video></video>${overlay}<button><svg aria-label="Unlike"></svg></button></div></main>`
    const current = window.document.querySelector('#current-reel')!
    for (const node of current.querySelectorAll('svg, span'))
      node.getBoundingClientRect = () => ({ left: 650, right: 680, top: 200, bottom: 230, width: 30, height: 30 }) as DOMRect
    window.document.elementFromPoint = () => current.querySelector('[aria-label="Video player"]')
    const video = current.querySelector('video')!
    Object.defineProperties(video, { duration: { value: 2 }, currentTime: { get: () => (now - started) / 1000 },
      paused: { value: false }, ended: { value: false } })
    const like = (node: Element | null) => {
      assert.ok(node && current.contains(node), 'input must never target a preloaded neighbor')
      current.querySelector('svg')!.setAttribute('aria-label', 'Unlike')
    }
    type Node = typeof current | null
    const locator = (resolve: () => Node): Locator => ({
      ...visibleActionGeometry,
      evaluate: async (fn: (node: Element) => unknown, kind: 'likes' | 'comments') => fn === liveLikeSelector
        ? fn(resolve() as unknown as Element) : fn === reelEngagementCount
          ? reelEngagementCount(resolve() as unknown as Element, kind) : visibleActionGeometry.evaluate(fn),
      evaluateAll: async (fn: (nodes: Element[]) => unknown) => fn(resolve() ? [resolve() as unknown as Element] : []),
      first() { return this },
      locator: (selector: string) => locator(() => resolve()?.querySelector(selector) ?? null),
      count: async () => Number(!!resolve()), isVisible: async () => !!resolve(),
      waitFor: async () => { assert.ok(resolve(), 'the Like must be confirmed as Unlike') },
      click: async () => { buttonClicks++; like(resolve() as unknown as Element) },
      hover: async () => {}, dblclick: async () => { doubleTaps++; like(resolve() as unknown as Element) },
    }) as unknown as Locator
    const post = locator(() => current)
    const target = {
      locator: (selector: string) => {
        if (selector === 'xpath=ancestor::*[@role="group" and @aria-label="Video player"][1]')
          return locator(() => video.closest('[role="group"][aria-label="Video player"]'))
        assert.equal(selector, 'xpath=ancestor::*[ancestor::main][count(.//video)=1][last()]')
        return post
      },
      boundingBox: async () => ({ x: 200, y: 0, width: 400, height: 600 }),
      evaluate: async (fn: (node: Element) => unknown) => fn(video as unknown as Element),
    }
    const page = { url: () => 'https://www.instagram.com/reels/current/',
      mouse: { dblclick: async () => { doubleTaps++; throw new Error('Reels must use the Like button') } },
      viewportSize: () => ({ width: 1280, height: 800 }),
      locator: (selector: string) => selector === 'video' ? { count: async () => 1, nth: () => target }
        : selector.startsWith('svg[data-igbot-like-target=') ? locator(() => window.document.querySelector(selector))
          : { filter: () => ({ evaluateAll: async () => null }) },
    } as unknown as Page
    const session = new BrowseSession(now + 60_000)
    session.wait = async ms => { now += Math.max(1, Math.ceil(ms)); session.check() }
    const budget = new WarmupActivityBudget({ likes: 1, profiles: 0, reels: 0, stories: 0 })
    try {
      await watchReels(page, session, { warmup_day: 2, warmup_topics: ['fitness'] }, () => {}, budget, async () => true)
      assert.equal(budget.used.likes, 1)
      assert.equal(doubleTaps, 0)
      assert.equal(buttonClicks, 1)
      assert.equal(current.querySelector('svg')!.getAttribute('aria-label'), 'Unlike')
      assert.equal(window.document.querySelector('#neighbor svg')!.getAttribute('aria-label'), 'Unlike')
    } finally { Date.now = originalNow; Math.random = originalRandom; await window.happyDOM.close() }
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
  let url = 'https://www.instagram.com/reels/current/', wheels = 0, clicks = 0
  const next = { ...visibleActionGeometry, filter() { return this }, first() { return this },
    isVisible: async () => options.nextVisible !== false, isEnabled: async () => options.nextEnabled !== false,
    hover: async () => {}, click: async () => { clicks++; if (options.changeOnClick !== false)
        url = `https://www.instagram.com/reels/next${options.successiveReels ? clicks : ''}/` },
  }
  const page = { url: () => url, viewportSize: () => options.fixedViewport !== false ? { width, height } : null,
    evaluate: async (fn: () => unknown) => window.eval(`(${fn.toString()})()`),
    locator: (selector: string) => selector === 'video' ? { count: async () => videos.length, nth: (i: number) => videos[i] }
      : selector.includes('Not Now') ? { count: async () => 0 }
      : selector.includes('Your Meta Account is here') ? { filter() { return this }, first() { return this }, isVisible: async () => false }
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
    assert.ok(selector === 'video' || selector.includes('Not Now') || selector.includes('Your Meta Account is here'),
      'opening the current viewer must not select the sidebar')
    return locator(selector)
  }) as Page['locator']
  try {
    assert.equal(await openReels(f.page, () => {}, f.session), true)
    assert.equal(f.stats().clicks, 0)
  } finally { await f.window.happyDOM.close() }
})

for (const recovery of ['settled', 'unsettled', 'timeout', 'stopped', 'deadline'] as const)
  test(`a stuck Reels viewer gets one bounded reload (${recovery})`, async () => {
    const f = reelAdvanceFixture(1024, 600), originalNow = Date.now
    let now = originalNow(), reloads = 0, stopped = false
    const started = now, notes: Record<string, unknown>[] = []
    Date.now = () => now
    const session = new BrowseSession(now + (recovery === 'deadline' ? 5500 : 60_000), () => stopped)
    session.wait = async ms => { now += ms; session.check() }
    f.boxes[1].y = 330
    f.page.reload = async options => {
      reloads++
      assert.equal(options?.waitUntil, 'domcontentloaded')
      assert.equal(options?.timeout, recovery === 'deadline' ? 500 : 5000)
      if (recovery === 'settled') f.boxes[1].y = 16
      if (recovery === 'stopped') stopped = true
      if (recovery === 'timeout' || recovery === 'deadline') {
        now += options!.timeout!
        throw new errors.TimeoutError('Reload timed out')
      }
      return null
    }
    try {
      const run = openReels(f.page, note => notes.push(note), session)
      if (recovery === 'stopped' || recovery === 'deadline') await assert.rejects(run, SessionEnded)
      else assert.equal(await run, recovery === 'settled')
      assert.equal(reloads, 1)
      assert.ok(now - started <= 15_000, 'recovery cannot reset the opening budget')
      assert.equal(f.stats().clicks, 0, 'reload does not click the sidebar again')
      assert.equal(notes.find(note => note.event === 'automation.actions.reels.settle_failed')?.reason, 'video_clipped')
      if (recovery === 'unsettled')
        assert.equal(notes.find(note => note.event === 'automation.actions.reels.open_failed')?.stage, 'settling_after_reload')
    } finally { Date.now = originalNow; await f.window.happyDOM.close() }
  })

test('a stop during settling prevents the Reels recovery reload', async () => {
  const f = reelAdvanceFixture(1024, 600)
  let stopped = false
  const session = new BrowseSession(Date.now() + 60_000, () => stopped)
  session.wait = async () => { stopped = true; session.check() }
  f.boxes[1].y = 330
  f.page.reload = async () => { throw new Error('Must not reload a stopped session') }
  try { await assert.rejects(openReels(f.page, () => {}, session), SessionEnded) }
  finally { await f.window.happyDOM.close() }
})

for (const recovery of ['settled', 'unavailable', 'timeout', 'stopped', 'deadline', 'account warning'] as const)
  test(`a missing Reel requests a fresh feed within the original budget (${recovery})`, async () => {
    const f = reelAdvanceFixture(1024, 600), originalNow = Date.now
    let now = originalNow(), navigations = 0, stopped = false
    const start = now, notes: Record<string, unknown>[] = []
    Date.now = () => now
    const session = new BrowseSession(now + (recovery === 'deadline' ? 5500 : 60_000), () => stopped)
    session.wait = async ms => { now += ms; session.check() }
    f.boxes.forEach(box => { box.x = -2000 })
    f.page.reload = async () => { throw new Error('An unavailable permalink must not be reloaded') }
    f.page.goto = async (url, options) => {
      navigations++
      assert.equal(url, 'https://www.instagram.com/reels/')
      assert.equal(options?.waitUntil, 'domcontentloaded')
      assert.equal(options?.timeout, recovery === 'deadline' ? 500 : 5000)
      if (recovery === 'timeout' || recovery === 'deadline') {
        now += options!.timeout!
        throw new errors.TimeoutError('Feed navigation timed out')
      }
      if (recovery === 'stopped') stopped = true
      if (recovery === 'settled') { f.boxes[1].x = 256; f.navigate('https://www.instagram.com/reels/fresh/') }
      return null
    }
    if (recovery === 'account warning') {
      const locator = f.page.locator.bind(f.page)
      f.page.locator = ((selector: string) => selector === '[role="dialog"], [role="alertdialog"], [role="alert"]'
        ? { filter: () => ({ evaluateAll: async () => 'limit' }) } : locator(selector)) as Page['locator']
    }
    try {
      const run = openReels(f.page, note => notes.push(note), session)
      if (recovery === 'stopped' || recovery === 'deadline') await assert.rejects(run, SessionEnded)
      else if (recovery === 'account warning') await assert.rejects(run, /limit needs attention/)
      else assert.equal(await run, recovery === 'settled')
      assert.equal(navigations, recovery === 'account warning' ? 0 : 1)
      assert.ok(now - start <= 15_000, 'recovery must share the original opening deadline')
      assert.equal(notes.find(note => note.event === 'automation.actions.reels.settle_failed')?.reason, 'video_unavailable')
      if (navigations) assert.equal(notes.find(note => note.event === 'automation.actions.reels.viewer_reload')?.recovery, 'fresh_feed')
    } finally { Date.now = originalNow; await f.window.happyDOM.close() }
  })

test('video lookup transport failures propagate instead of masquerading as missing media', async () => {
  const f = reelAdvanceFixture(1024, 600)
  const locator = f.page.locator.bind(f.page)
  f.page.locator = ((selector: string) => selector === 'video'
    ? { count: async () => { throw new Error('Browser disconnected') } } : locator(selector)) as Page['locator']
  f.page.goto = async () => { throw new Error('Transport failures must not retry navigation') }
  try { await assert.rejects(openReels(f.page, () => {}, f.session), /Browser disconnected/) }
  finally { await f.window.happyDOM.close() }
})

test('a failed Reels sidebar click does not wait for navigation or retry the click', async () => {
  let clicks = 0, waits = 0
  const button = { ...visibleActionGeometry, filter() { return this }, first() { return this }, isVisible: async () => true,
    waitFor: async () => { clicks++; throw new errors.TimeoutError('Sidebar target disappeared') } }
  const page = { url: () => 'https://www.instagram.com/alice/', locator: (selector: string) => selector.includes('Your Meta Account is here')
    ? { filter() { return this }, first() { return this }, isVisible: async () => false }
    : selector.includes('Not Now') ? { count: async () => 0 } : button,
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
    hover: async () => {}, click: async () => {} }
  f.page.url = () => onReels ? 'https://www.instagram.com/reels/current/' : 'https://www.instagram.com/alice/'
  f.page.locator = ((selector: string) => selector === 'video' || selector.includes('Not Now') || selector.includes('Your Meta Account is here')
    ? locator(selector) : button) as Page['locator']
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

test('Reels opening dismisses the inbox notification prompt before clicking the sidebar', async () => {
  const f = reelAdvanceFixture(1024, 600)
  f.navigate('https://www.instagram.com/direct/inbox/')
  let popupOpen = true
  const clicks: string[] = []
  const locator = f.page.locator.bind(f.page)
  const popup = { dispose: async () => {}, waitForElementState: async () => {
    assert.equal(popupOpen, false, 'the notification dialog must actually close')
  } }
  const notNow = {
    isVisible: async () => popupOpen,
    locator: () => ({ elementHandle: async () => popup }),
    ...visibleActionGeometry, hover: async () => {}, click: async () => { popupOpen = false; clicks.push('not-now') },
  }
  const reels = { filter() { return this }, first() { return this }, isVisible: async () => true,
    ...visibleActionGeometry, hover: async () => {}, click: async () => {
      assert.equal(popupOpen, false, 'Reels must not be clicked underneath a notification prompt')
      clicks.push('reels'); f.navigate('https://www.instagram.com/reels/current/')
    },
  }
  f.page.locator = ((selector: string) => selector.includes('Not Now')
    ? { count: async () => Number(popupOpen), nth: () => notNow }
    : selector.includes('aria-label="Reels"') ? reels : locator(selector)) as Page['locator']
  f.page.waitForURL = async () => { assert.match(f.page.url(), /\/reels\//) }
  try {
    assert.equal(await openReels(f.page, () => {}, f.session), true)
    assert.deepEqual(clicks, ['not-now', 'reels'])
  } finally { await f.window.happyDOM.close() }
})

for (const moved of [true, false]) test(`skipping a changing reel counts browsing progress only after verified advancement (${moved})`, async () => {
  const f = reelAdvanceFixture(1024, 600, { changeOnClick: moved, contextFailure: new Error('Element is not attached to the DOM') })
  const budget = new WarmupActivityBudget({ likes: 0, profiles: 0, reels: 1, stories: 0 })
  try {
    await watchReels(f.page, f.session, {}, () => {}, budget)
    assert.equal(budget.browsed, moved ? 1 : 0)
    assert.equal(budget.used.reels, 0, 'skipping is progress but does not claim a watched reel')
  } finally { await f.window.happyDOM.close() }
})

test('off-topic reels can make browsing progress without any completed watches', async () => {
  const f = reelAdvanceFixture(1024, 600, { offTopic: true })
  const budget = new WarmupActivityBudget({ likes: 0, profiles: 0, reels: 1, stories: 0 })
  const notes: Record<string, unknown>[] = []
  try {
    await watchReels(f.page, f.session, { warmup_topics: 'fitness', reels_skip_chance: 0 }, note => notes.push(note), budget, async () => false)
    assert.equal(budget.browsed, 1)
    assert.equal(budget.used.reels, 0)
    assert.ok(notes.some(note => note.event === 'automation.warmup.reel_off_topic'))
    assert.equal(notes.find(note => note.event === 'automation.reels_result')?.watchedCount, 0)
  } finally { await f.window.happyDOM.close() }
})

for (const mode of ['related', 'unrelated', 'empty', 'ad'] as const)
  test(`sound is checked only after a positive interest decision (${mode})`, async () => {
    const f = reelAdvanceFixture(1024, 600, { offTopic: true }), originalNow = Date.now
    let now = originalNow()
    Date.now = () => now
    const started = now, events: string[] = []
    const video = f.window.document.querySelector('#current')!
    Object.defineProperties(video, {
      muted: { get: () => { events.push('sound'); return false } },
      currentTime: { get: () => (now - started) / 1000 },
      paused: { value: false }, ended: { value: false },
    })
    if (mode === 'ad') {
      const ad = f.window.document.createElement('a')
      ad.href = 'https://www.facebook.com/ads/ig_redirect/'
      ad.getBoundingClientRect = () => ({ width: 200, height: 48, top: 100, bottom: 148, left: 200, right: 400 }) as DOMRect
      video.parentElement!.append(ad)
    }
    f.session.wait = async ms => { now += Math.max(1, Math.ceil(ms)); f.session.check() }
    try {
      await assert.rejects(watchReels(f.page, Object.assign(f.session, { cancelled: () => f.stats().clicks >= 1 }), { warmup_topics: mode === 'empty' ? [] : ['Fishing'] }, () => {}, undefined, async () => {
          events.push('classify'); return mode === 'related'
        }), SessionEnded)
      assert.deepEqual(events, mode === 'related' ? ['classify', 'sound'] : mode === 'unrelated' ? ['classify'] : [])
      assert.equal(f.stats().clicks, 1)
    } finally { Date.now = originalNow; await f.window.happyDOM.close() }
  })

for (const ad of [false, true]) test(`Reels pause before classification and skip rejected content immediately (ad=${ad})`, async () => {
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
    await assert.rejects(watchReels(f.page, Object.assign(f.session, { cancelled: () => f.stats().clicks >= 1 }), { warmup_topics: ['Fishing'] }, () => {}, budget, async () => {
        assert.equal(waits.length, 1, 'pause happens before the screenshot/classification')
        assert.ok(waits[0] >= 500 && waits[0] <= 1200)
        decisions.push(1); return false
      }), SessionEnded)
    assert.equal(f.stats().clicks, 1)
    if (ad) assert.deepEqual(waits, [], 'cancellation prevents a settling wait after advancing')
    else {
      assert.ok(waits[0] >= 500 && waits[0] <= 1200, 'capture waits 0.5–1.2 seconds')
      assert.deepEqual(waits.slice(1), [], 'cancellation prevents a settling wait after advancing')
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
    await assert.rejects(watchReels(f.page, session, { reels_min: 1, reels_max: 1 }, () => {}, budget), SessionEnded)
    assert.ok(budget.used.reels > 1, 'the old daily and min/max counts cannot stop viewing')
    assert.ok(f.stats().clicks > 1)
    assert.equal(now, session.end)
  } finally { Date.now = originalNow; Math.random = originalRandom; await f.window.happyDOM.close() }
})

test('a detached reel caption skips that reel instead of ending the session', async () => {
  const f = reelAdvanceFixture(1024, 600, { changeOnClick: false, contextFailure: new Error('Element is not attached to the DOM') })
  const notes: Record<string, unknown>[] = []
  try {
    await watchReels(f.page, f.session, {}, note => notes.push(note))
    assert.equal(f.stats().clicks, 1, 'try the next reel after losing caption context')
    assert.ok(notes.some(note => note.event === 'automation.actions.reels.context_unavailable'))
  } finally { await f.window.happyDOM.close() }
})

test('reel caption recovery still stops on visible Instagram limits', async () => {
  const f = reelAdvanceFixture(1024, 600, { contextFailure: new errors.TimeoutError('Caption changed'), warningAfterFailure: true })
  try {
    await assert.rejects(watchReels(f.page, f.session, {}, () => {}), /limit needs attention/)
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
      assert.equal(notes.find(note => note.event === 'automation.actions.reels.advance_failed')?.stage,
        failure === 'transport' ? 'wheel' : failure === 'unsettled' ? 'settling' : 'navigation')
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
    await watchReels(page, session, { soft_warmup: false, warmup_topics: 'fitness', like_chance: 100, reels_skip_chance: followed ? 100 : 0 }, () => {}, budget, async (context, _topics, _session, _log, screenshotTarget) => {
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
