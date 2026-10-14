import { visibleActionGeometry } from './action-locator.test-support.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { Window } from 'happy-dom'
import { BrowseSession, SessionEnded } from './session.js'
import { revealForClick, settleOnPost, smoothScroll } from './scroll.js'
import { likeVisible, clickVisible } from './mouse.js'
import { viewContent, viewVideo } from './viewing.js'
import { openDMs } from './inbox.js'
import { openReels } from './reels.js'
import { backToFeed } from './navigation.js'
import { openAuthorProfile, openOwnProfile } from './profiles.js'
import { watchStories } from './stories.js'

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

test('settling checks posts beyond six and ignores fully offscreen posts', async () => {
  const checked: number[] = []
  let wheelCalls = 0
  const posts = [-1800, -1500, -1200, -900, -600, -300, 100].map((y, i) => ({
    boundingBox: async () => { checked.push(i); return { x: 0, y, width: 400, height: 250 } },
  }))
  const page = {
    viewportSize: () => ({ width: 1280, height: 800 }),
    locator: () => ({ count: async () => posts.length, nth: (i: number) => posts[i] }),
    mouse: { wheel: async () => { wheelCalls++ } },
  } as unknown as Page
  await settleOnPost(page)
  assert.equal(wheelCalls, 0)
  assert.ok(checked.includes(6))
  posts.pop()
  await settleOnPost(page)
  assert.equal(wheelCalls, 0)
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
    elementHandle: async () => button,
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

test('likes are confirmed, and already-liked posts are untouched', async () => {
  const existing = likeTarget(true, true)
  assert.equal(await likeVisible(existing.target), false)
  assert.equal(existing.clicks(), 0)
  const success = likeTarget(false, true)
  assert.equal(await likeVisible(success.target), true)
  assert.equal(success.clicks(), 1)
  const failed = likeTarget(false, false)
  assert.equal(await likeVisible(failed.target), false)
  assert.equal(failed.clicks(), 1)
})

test('visible-in-DOM but offscreen controls are not clicked', async () => {
  const offscreen = likeTarget(false, true, 900)
  assert.equal(await clickVisible(offscreen.target, 'button'), false)
  assert.equal(offscreen.clicks(), 0)
})

test('opening an author adapts the selected nested link before clicking', async () => {
  let currentUrl = 'https://www.instagram.com/'
  const author = {
    first() { return this },
    getAttribute: async () => '/alice/',
    boundingBox: async () => ({ x: 100, y: 100, width: 100, height: 30 }),
    isVisible: async () => true,
    elementHandle: async () => ({
      ...visibleActionGeometry, hover: async () => {},
      click: async () => { currentUrl = 'https://www.instagram.com/alice/' },
      dispose: async () => {},
    }),
    page: () => page,
    click: async () => { throw new Error('Cloak rejects a chained author selector') },
  }
  const page = {
    viewportSize: () => ({ width: 1280, height: 800 }),
    url: () => currentUrl,
    locator: () => { throw new Error('Must not resolve the selected author again') },
  } as unknown as Page
  const target = { locator: () => author } as unknown as Locator
  const session = new BrowseSession()
  session.wait = async () => {}
  assert.equal(await openAuthorProfile(page, target, session), true)
  assert.equal(currentUrl, 'https://www.instagram.com/alice/')
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
      locator: (selector: string) => selector.includes('Story by') ? story : { count: async () => 0 },
    } as unknown as Page
    assert.equal(await watchStories(page, 0, () => {}, () => stopped), 0)
    assert.equal(clicks, stopWhileLoading ? 0 : 1)
  }
})

test('story navigation and opening expiry stay local to the optional story chunk', async () => {
  const originalNow = Date.now
  for (const expiresAt of ['navigation', 'visibility', 'hover']) {
    let now = originalNow(), clicks = 0
    const deadline = now + 10_000
    Date.now = () => now
    const story = { first() { return this }, waitFor: async () => {},
      evaluateAll: async () => ['alice'],
      isVisible: async () => { if (expiresAt === 'visibility') now += 11_000; return true },
      elementHandle: async () => ({ ...visibleActionGeometry, dispose: async () => {},
        hover: async () => { now += 11_000; throw new errors.TimeoutError('Story opening expired') },
        click: async () => { clicks++ },
      }),
    }
    const page = { url: () => expiresAt === 'navigation' ? 'https://www.instagram.com/alice/' : 'https://www.instagram.com/',
      goto: async (_url: string, options: { timeout: number }) => {
        assert.equal(options.timeout, 10_000)
        if (expiresAt === 'navigation') { now += 11_000; throw new errors.TimeoutError('Navigation expired') }
      }, keyboard: { press: async () => {} },
      locator: (selector: string) => selector.includes('Story by') ? story : { count: async () => 0 },
    } as unknown as Page
    try {
      assert.equal(await watchStories(page, 1, () => {}, () => false, { minSeconds: 2, maxSeconds: 5, deadline }), 0)
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
    elementHandle: async () => ({ ...visibleActionGeometry, hover: async () => { if (stage === 'open') throw failure },
      click: async () => { opened = true }, dispose: async () => {} }),
  }
  const next = { ...control, page: () => page,
    elementHandle: async () => ({ ...visibleActionGeometry, hover: async () => { throw failure }, dispose: async () => {} }),
  }
  const page = { url: () => opened ? 'https://www.instagram.com/stories/alice/1/' : 'https://www.instagram.com/', viewportSize: () => ({ width: 1280, height: 800 }),
    keyboard: { press: async () => {} },
    locator: (selector: string) => selector.includes('Story by') ? control : selector.includes('Next')
      ? { count: async () => 1, nth: () => next }
      : { filter() { return this }, first() { return this }, count: async () => 0, isVisible: async () => false, evaluateAll: async () => null },
  } as unknown as Page
  const watched = await watchStories(page, 2, note => notes.push(note), () => false,
    { minSeconds: 0, maxSeconds: 0, deadline: Date.now() + 60_000 })
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
          const nodes = [...window.document.querySelectorAll(selector.replaceAll(':visible', ''))]
            .filter(node => !selector.includes(':visible') || node.getAttribute('style') !== 'display:none')
          return { count: async () => nodes.length, first: () => ({
            waitFor: async () => { assert.ok(nodes[0]) },
            isVisible: async () => !!nodes[0] && nodes[0].getAttribute('style') !== 'display:none',
            elementHandle: async () => ({ ...visibleActionGeometry, hover: async () => {}, click: async () => { clicked = nodes[0]!.id }, dispose: async () => {} }),
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
    const next = { ...control, elementHandle: async () => ({
      ...visibleActionGeometry, hover: async () => {},
      click: async () => { stopped = true }, dispose: async () => {},
    }) }
    const page = {
      goto: async () => {}, url: () => opened ? 'https://www.instagram.com/stories/alice/1/' : 'https://www.instagram.com/',
      viewportSize: () => ({ width: 1280, height: 800 }),
      keyboard: { press: async () => {} },
      locator: (selector: string) => selector.includes('Story by') ? control
        : selector.includes('Next') ? next : { count: async () => 0, filter: () => ({ evaluateAll: async () => null }) },
    } as unknown as Page
    const watched = await watchStories(page, mode === 'stop on next' ? 3 : 1, () => {}, () => stopped,
      { minSeconds: 0, maxSeconds: 0 })
    assert.equal(watched, mode === 'full' || mode === 'stop on next' ? 1 : 0)
  }
})
