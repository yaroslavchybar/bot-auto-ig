import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright-core'
import { Window } from 'happy-dom'
import { BrowseSession, SessionEnded } from './session.js'
import { settleOnPost, smoothScroll } from './scroll.js'
import { likeVisible, clickVisible } from './mouse.js'
import { detourDelay, postChoices, viewContent, viewVideo } from './viewing.js'
import { openDMs } from './inbox.js'
import { openReels } from './reels.js'
import { backToFeed } from './navigation.js'
import { openAuthorProfile, openOwnProfile } from './profiles.js'
import { watchStories } from './stories.js'

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

test('carousel choice rolls once per post', () => {
  const original = Math.random
  let rolls = 0
  Math.random = () => { rolls++; return 0.5 }
  try {
    assert.deepEqual(postChoices({ like_chance: 100, follow_chance: 0, carousel_watch_chance: 20 }),
      { carousel: false })
    assert.equal(rolls, 1)
  } finally { Math.random = original }
})

test('browsing never selects feed likes or follows even with previously active settings', () => {
  assert.deepEqual(postChoices({ soft_warmup: false, like_chance: 100, follow_chance: 100, carousel_watch_chance: 0 }),
    { carousel: false })
})

test('detour spacing scales with session length and has a minimum', () => {
  assert.equal(detourDelay(300_000), 75_000)
  assert.equal(detourDelay(600_000), 150_000)
  assert.equal(detourDelay(10_000), 30_000)
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
      hover: async () => {},
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
      hover: async () => {},
      dispose: async () => {},
      waitFor: async () => { loaded = true; stopped = stopWhileLoading },
      isVisible: async () => loaded,
      click: async () => { assert.equal(loaded, true); clicks++ },
    }
    const page = {
      goto: async () => {},
      url: () => 'https://www.instagram.com/',
      keyboard: { press: async () => {} },
      locator: (selector: string) => selector.includes('Story by') ? story : { count: async () => 0 },
    } as unknown as Page
    assert.equal(await watchStories(page, 0, () => {}, () => stopped), 0)
    assert.equal(clicks, stopWhileLoading ? 0 : 1)
  }
})

test('stories skip a hidden first control in either tray layout', async () => {
  for (const visibleKind of ['button', 'link']) {
    const window = new Window()
    try {
      window.document.body.innerHTML = `<main><div role="button" aria-label="Story by hidden" style="display:none"></div><a href="/stories/hidden/" style="display:none"></a>${visibleKind === 'button'
        ? '<div id="visible-story" role="button" aria-label="Story by alice"></div>'
        : '<a id="visible-story" href="/stories/alice/"></a>'}</main>`
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
            elementHandle: async () => ({ hover: async () => {}, click: async () => { clicked = nodes[0]!.id }, dispose: async () => {} }),
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
    let stopped = false
    const control = {
      first() { return this }, nth() { return this },
      count: async () => 1, waitFor: async () => {},
      isVisible: async () => mode !== 'missing',
      boundingBox: async () => ({ x: 100, y: 100, width: 40, height: 40 }),
      page: () => page,
      elementHandle: async () => control, dispose: async () => {},
      hover: async () => {},
      click: async () => { stopped = mode === 'stop on open' },
    }
    const next = { ...control, elementHandle: async () => ({
      hover: async () => {},
      click: async () => { stopped = true }, dispose: async () => {},
    }) }
    const page = {
      goto: async () => {}, url: () => 'https://www.instagram.com/',
      viewportSize: () => ({ width: 1280, height: 800 }),
      keyboard: { press: async () => {} },
      locator: (selector: string) => selector.includes('Story by') ? control
        : selector.includes('Next') ? next : { count: async () => 0 },
    } as unknown as Page
    const watched = await watchStories(page, mode === 'stop on next' ? 3 : 1, () => {}, () => stopped,
      { minSeconds: 0, maxSeconds: 0 })
    assert.equal(watched, mode === 'full' || mode === 'stop on next' ? 1 : 0)
  }
})
