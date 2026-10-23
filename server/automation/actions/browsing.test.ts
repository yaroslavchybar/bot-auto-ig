import { visibleActionGeometry } from './action-locator.test-support.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { Window } from 'happy-dom'
import { BrowseSession, SessionEnded } from './session.js'
import { quickScroll, revealForClick, smoothScroll } from './scroll.js'
import { clickVisible } from './mouse.js'
import { viewContent, viewVideo } from './viewing.js'
import { openDMs } from './inbox.js'
import { openReels } from './reels.js'
import { backToFeed } from './navigation.js'
import { openAuthorProfile, openOwnProfile } from './profiles.js'
import { watchStories } from './stories.js'
import { actionLocator } from './action-locator.js'

const absentControl = { filter() { return this }, first() { return this }, isVisible: async () => false,
  count: async () => 0, evaluateAll: async () => null }

const completedStory = {
  chance: () => false,
  visit: async () => {},
  progress: async () => ({ index: 0, total: 1, progress: 1 }),
  click: async (_page: Page, target: Locator, session: BrowseSession) => {
    await (await actionLocator(target, session.timeout(5000))).click({ timeout: session.timeout(5000) })
  },
  wait: async (session: BrowseSession) => { session.check() },
}

test('revealing a grid tile uses viewport bounds after the document has scrolled', async () => {
  const window = new Window({ width: 1280, height: 800 })
  try {
    const document = window.document, root = document.documentElement
    document.body.innerHTML = '<a href="/alice/reel/top/">Top Reel</a>'
    root.style.overflowY = 'scroll'
    Object.defineProperties(root, { clientHeight: { value: 800 }, scrollHeight: { value: 3000 } })
    let offset = 1200, wheels = 0
    root.getBoundingClientRect = () => ({ top: -offset, bottom: 800 - offset, left: 0, right: 1280 }) as DOMRect
    const target = { boundingBox: async () => ({ x: 200, y: 800 - offset, width: 300, height: 500 }),
      evaluate: async (fn: (node: Element) => unknown) => fn(document.querySelector('a')! as unknown as Element) }
    const page = { viewportSize: () => ({ width: 1280, height: 800 }), mouse: {
      move: async () => {}, wheel: async (_x: number, y: number) => { wheels++; offset += y },
    } } as unknown as Page
    const session = new BrowseSession(Date.now() + 60_000)
    session.wait = async () => { session.check() }
    assert.equal(await revealForClick(page, target as unknown as Locator, session), true)
    assert.ok(wheels > 0)
    assert.ok(offset < 1200)
  } finally { await window.happyDOM.close() }
})

test('fast skips keep an eased wheel glide, cover the post, and use less time', async () => {
  const originalRandom = Math.random
  Math.random = () => 0.5
  const deltas: number[] = []
  let elapsed = 0
  const page = { mouse: { wheel: async (_x: number, delta: number) => { deltas.push(delta) } } } as unknown as Page
  const session = new BrowseSession(Date.now() + 60_000)
  session.wait = async ms => { elapsed += ms; session.check() }
  try {
    await quickScroll(page, 400, session)
    assert.ok(deltas.length >= 8, 'a skip must stay smooth rather than jump with one wheel event')
    assert.equal(deltas.reduce((sum, delta) => sum + delta, 0), 400)
    assert.ok(Math.max(...deltas) > deltas[0] && Math.max(...deltas) > deltas.at(-1)!)
    const skipElapsed = elapsed
    assert.ok(skipElapsed <= 300)
    elapsed = 0; deltas.length = 0
    await smoothScroll(page, 400, session)
    assert.ok(elapsed > skipElapsed, 'normal viewing keeps its existing slower glide')
  } finally { Math.random = originalRandom }
})

for (const { height, startY, needsScroll } of [
  { height: 400, startY: 100, needsScroll: false },
  { height: 400, startY: 500, needsScroll: true },
  { height: 400, startY: 0, needsScroll: true },
  { height: 100, startY: 160, needsScroll: true },
]) test(`revealing a ${height}px target at ${startY}px respects a 200px scroll region`, async () => {
  const window = new Window()
  try {
    window.document.body.innerHTML = '<div style="overflow-y:auto"><a>Target</a></div>'
    const node = window.document.querySelector('a')!, panel = node.parentElement!
    Object.defineProperties(panel, { clientHeight: { value: 200 }, scrollHeight: { value: 1200 } })
    panel.getBoundingClientRect = () => ({ top: 200, bottom: 400, left: 300, right: 600 }) as DOMRect
    let y = startY, wheels = 0
    const target = {
      boundingBox: async () => ({ x: 350, y, width: 40, height }),
      evaluate: async <R>(fn: (el: Element) => R): Promise<R> => fn(node as unknown as Element),
    }
    const page = { viewportSize: () => ({ width: 1280, height: 800 }),
      mouse: { move: async () => {}, wheel: async (_x: number, delta: number) => { wheels++; y -= delta } },
    } as unknown as Page
    const session = new BrowseSession()
    session.wait = async () => {}
    assert.equal(await revealForClick(page, target, session), true)
    assert.equal(wheels > 0, needsScroll)
    if (height > 200) assert.ok(y + height / 2 > 200 && y + height / 2 < 400)
    else assert.ok(y >= 200 && y + height <= 400, 'a target that fits must remain fully visible')
  } finally { await window.happyDOM.close() }
})

test('one deadline caps waits and prevents actions after expiry', async () => {
  const session = new BrowseSession(Date.now() + 20)
  assert.ok(session.timeout(10_000) <= 20)
  await assert.rejects(session.wait(10_000), SessionEnded)
  assert.throws(() => session.timeout(5_000), SessionEnded)
  const page = {} as Page
  await assert.rejects(smoothScroll(page, 500, session), SessionEnded)
  await assert.rejects(openDMs(page, () => {}, session), SessionEnded)
  await assert.rejects(openReels(page, () => {}, session), SessionEnded)
  await assert.rejects(openOwnProfile(page, () => {}, session), SessionEnded)
  await assert.rejects(backToFeed(page, () => {}, session), SessionEnded)
})

test('stop interrupts a long wait instead of waiting out the duration', async () => {
  let stopped = false
  const session = new BrowseSession(Infinity, () => stopped)
  const pending = session.wait(60_000)
  stopped = true
  await assert.rejects(pending, SessionEnded)
})

test('photos finish their viewing wait before returning', async () => {
  const session = new BrowseSession()
  const waits: number[] = []
  session.wait = async ms => { waits.push(ms) }
  const target = { locator: () => ({ first: () => ({ count: async () => 0 }) }) } as unknown as Locator
  assert.equal(await viewContent(target, 2400, session), true)
  assert.deepEqual(waits, [2400])
})

test('video viewing counts playback rather than buffering time', async () => {
  const session = new BrowseSession()
  let ticks = 0
  session.wait = async () => { ticks++ }
  const video = { evaluate: async () => ticks === 0 ? 0 : ({
    time: Math.max(0, ticks - 2) * 0.25, paused: ticks <= 2, ended: false,
  }) } as unknown as Locator
  assert.equal(await viewVideo(video, 500, session), true)
  assert.equal(ticks, 4)
})

function likeTarget(alreadyLiked: boolean, confirms: boolean, y = 100) {
  let liked = alreadyLiked
  let clicks = 0
  const unlike = { count: async () => Number(liked), first: () => ({ waitFor: async () => {} }) }
  const button = {
    ...visibleActionGeometry,
    boundingBox: async () => ({ x: 100, y, width: 30, height: 30 }),
    hover: async () => {},
    dispose: async () => {},
    page: () => ({
      viewportSize: () => ({ width: 1280, height: 800 }),
    }),
    isVisible: async () => true,
    click: async () => { clicks++; liked = confirms },
  }
  const target = { locator: (s: string) => s.includes('Unlike') ? unlike : ({ count: async () => 1, nth: () => button }) } as unknown as Locator
  return { target, clicks: () => clicks }
}

test('visible-in-DOM but offscreen controls are not clicked', async () => {
  const offscreen = likeTarget(false, true, 900)
  assert.equal(await clickVisible(offscreen.target, 'button'), false)
  assert.equal(offscreen.clicks(), 0)
})

test('opening an author clicks the scoped locator directly', async () => {
  const window = new Window()
  window.document.body.innerHTML = '<a href="/alice/">alice</a>'
  const link = window.document.querySelector('a')!
  let currentUrl = 'https://www.instagram.com/'
  const author = {
    ...visibleActionGeometry,
    first() { return this },
    getAttribute: async () => '/alice/',
    evaluate: async (fn: (node: Element) => unknown) => fn(link as unknown as Element),
    evaluateAll: async () => {},
    boundingBox: async () => ({ x: 100, y: 100, width: 100, height: 30 }),
    isVisible: async () => true,
    waitFor: async () => {},
    page: () => page,
    click: async () => { currentUrl = 'https://www.instagram.com/alice/' },
  }
  const page = {
    viewportSize: () => ({ width: 1280, height: 800 }),
    url: () => currentUrl,
    locator: () => ({ filter: () => ({ evaluateAll: async () => null }) }),
  } as unknown as Page
  const target = { locator: () => author } as unknown as Locator
  const session = new BrowseSession()
  session.wait = async () => {}
  try {
    assert.equal(await openAuthorProfile(page, target, session), true)
    assert.equal(currentUrl, 'https://www.instagram.com/alice/')
  } finally { await window.happyDOM.close() }
})

test('stories wait for the button tray and honor a stop while it loads', async () => {
  for (const stopWhileLoading of [false, true]) {
    let loaded = false, stopped = false, clicks = 0
    const story = {
      first() { return this },
      elementHandle: async () => story,
      ...visibleActionGeometry, hover: async () => {},
      dispose: async () => {},
      waitFor: async () => { loaded = true; stopped = stopWhileLoading },
      isVisible: async () => loaded,
      click: async () => { assert.equal(loaded, true); clicks++ },
    }
    const page = {
      goto: async () => { throw new Error('Stories must reuse the already-open Home page') },
      url: () => 'https://www.instagram.com/',
      keyboard: { press: async () => {} },
      locator: (selector: string) => selector.includes('Story by') ? story : absentControl,
    } as unknown as Page
    assert.equal(await watchStories(page, 0, () => {}, () => stopped), 0)
    assert.equal(clicks, stopWhileLoading ? 0 : 1)
  }
})

test('story navigation and opening expiry stay local to the optional story chunk', async () => {
  const originalNow = Date.now
  for (const expiresAt of ['navigation', 'visibility', 'click']) {
    let now = originalNow(), clicks = 0
    const deadline = now + 10_000
    Date.now = () => now
    const story = { first() { return this }, waitFor: async () => {},
      evaluateAll: async () => ['alice'],
      isVisible: async () => { if (expiresAt === 'visibility') now += 11_000; return true },
      ...visibleActionGeometry, click: async () => { now += 11_000; throw new errors.TimeoutError('Story opening expired') },
    }
    const page = { url: () => expiresAt === 'navigation' ? 'https://www.instagram.com/alice/' : 'https://www.instagram.com/',
      goto: async (_url: string, options: { timeout: number }) => {
        assert.equal(options.timeout, 10_000)
        if (expiresAt === 'navigation') { now += 11_000; throw new errors.TimeoutError('Navigation expired') }
      }, keyboard: { press: async () => {} },
      locator: (selector: string) => selector.includes('Story by') ? story : absentControl,
    } as unknown as Page
    try {
      assert.equal(await watchStories(page, 1, () => {}, () => false, { deadline }), 0)
      assert.equal(clicks, 0)
    } finally { Date.now = originalNow }
  }
})

test('unexpected story failures still propagate', async () => {
  const page = { goto: async () => { throw new Error('Browser connection lost') } } as unknown as Page
  await assert.rejects(watchStories(page, 1, () => {}, () => false), /Browser connection lost/)
})

for (const stage of ['open', 'next']) test(`temporary story ${stage} failure skips stories while browsing time remains`, async () => {
  const failure = new errors.TimeoutError('Story control changed')
  const notes: Record<string, unknown>[] = []
  let opened = false
  const control = { ...visibleActionGeometry, first() { return this }, waitFor: async () => {}, isVisible: async () => true,
    evaluateAll: async () => ['alice'],
    click: async () => { if (stage === 'open') throw failure; opened = true },
  }
  const next = { ...control, page: () => page,
    ...visibleActionGeometry, click: async () => { throw failure },
  }
  const page = { url: () => opened ? 'https://www.instagram.com/stories/alice/1/' : 'https://www.instagram.com/', viewportSize: () => ({ width: 1280, height: 800 }),
    waitForURL: async () => {},
    getByRole: (_role: string, { name }: { name: string }) => ({ filter() { return this }, first() { return this },
      ...visibleActionGeometry, isVisible: async () => name === 'Next', waitFor: next.waitFor, click: next.click }),
    keyboard: { press: async () => {} },
    locator: (selector: string) => selector.includes('Story by') ? control : selector.includes('Next')
      ? { count: async () => 1, nth: () => next }
      : { filter() { return this }, first() { return this }, count: async () => 0, isVisible: async () => false, evaluateAll: async () => null },
  } as unknown as Page
  const watched = await watchStories(page, 2, note => notes.push(note), () => false,
    { deadline: Date.now() + 60_000 }, completedStory)
  assert.equal(watched, stage === 'open' ? 0 : 1)
  assert.ok(notes.some(note => note.event === 'automation.actions.stories.skipped'))
})

test('stories skip hidden or already-seen controls before choosing an unseen story', async () => {
  for (const skipped of ['hidden', 'seen']) {
    const window = new Window()
    try {
      window.document.body.innerHTML = `<main><div role="button" aria-label="Story by old, ${skipped === 'seen' ? 'seen' : 'not seen'}" ${skipped === 'hidden' ? 'style="display:none"' : ''}></div>
        <div id="visible-story" role="button" aria-label="Story by alice, not seen"></div></main>`
      let clicked = ''
      const page = {
        goto: async () => {}, url: () => 'https://www.instagram.com/',
        keyboard: { press: async () => {} },
        locator: (selector: string) => {
          if (selector.includes('Your Meta Account is here')) return absentControl
          const nodes = [...window.document.querySelectorAll(selector.replaceAll(':visible', ''))]
            .filter(node => !selector.includes(':visible') || node.getAttribute('style') !== 'display:none')
          return { count: async () => nodes.length, first: () => ({
            waitFor: async () => { assert.ok(nodes[0]) },
            isVisible: async () => !!nodes[0] && nodes[0].getAttribute('style') !== 'display:none',
            ...visibleActionGeometry, hover: async () => {}, click: async () => { clicked = nodes[0]!.id },
          }) }
        },
      } as unknown as Page
      assert.equal(await watchStories(page, 0, () => {}, () => false), 0)
      assert.equal(clicked, 'visible-story')
    } finally { await window.happyDOM.close() }
  }
})

test('stories return zero for missing trays and only completed views after an early stop', async () => {
  for (const mode of ['missing', 'full', 'stop on open', 'stop on next']) {
    let stopped = false, opened = false
    const control = {
      first() { return this }, nth() { return this },
      count: async () => 1, waitFor: async () => {},
      evaluateAll: async () => ['alice'],
      isVisible: async () => mode !== 'missing',
      boundingBox: async () => ({ x: 100, y: 100, width: 40, height: 40 }),
      page: () => page,
      elementHandle: async () => control, dispose: async () => {},
      ...visibleActionGeometry, hover: async () => {},
      click: async () => { opened = true; stopped = mode === 'stop on open' },
    }
    const next = { ...control, ...visibleActionGeometry, hover: async () => {}, click: async () => { stopped = true } }
    const page = {
      goto: async () => {}, url: () => opened ? 'https://www.instagram.com/stories/alice/1/' : 'https://www.instagram.com/',
      waitForURL: async () => {},
      getByRole: (_role: string, { name }: { name: string }) => ({ filter() { return this }, first() { return this },
        ...visibleActionGeometry, isVisible: async () => name === 'Next', waitFor: next.waitFor, click: next.click }),
      viewportSize: () => ({ width: 1280, height: 800 }),
      keyboard: { press: async () => {} },
      locator: (selector: string) => selector.includes('Story by') ? control
        : selector.includes('Next') ? next : absentControl,
    } as unknown as Page
    const watched = await watchStories(page, mode === 'stop on next' ? 3 : 1, () => {}, () => stopped,
      {}, completedStory)
    assert.equal(watched, mode === 'full' || mode === 'stop on next' ? 1 : 0)
  }
})
