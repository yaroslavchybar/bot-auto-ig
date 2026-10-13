import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { Window } from 'happy-dom'
import { errors } from 'playwright-core'
import { visibleActionGeometry } from './action-locator.test-support.js'
import { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { advanceReel, watchReels } from './reels.js'
import { BrowseSession, SessionEnded } from './session.js'

test('disabled reels never access the browser', async () => {
  await watchReels({} as Page, 5, { scroll_reels: false }, () => {}, () => false, Date.now() + 60_000)
})

function reelAdvanceFixture(width: number, height: number, options: { nextVisible?: boolean; nextEnabled?: boolean; fixedViewport?: boolean; changeOnClick?: boolean } = {}) {
  const window = new Window({ width, height })
  window.document.body.innerHTML = '<main><div style="overflow-y:auto;scroll-snap-type:y mandatory"><video id="previous"></video><video id="current"></video></div></main>'
  const panel = window.document.querySelector('main > div')!
  const step = height - 96
  Object.defineProperties(panel, { clientHeight: { value: step }, scrollHeight: { value: step * 3 } })
  panel.getBoundingClientRect = () => ({ left: 64, right: width - 32, top: 48, bottom: height - 48 }) as DOMRect
  const boxes = [
    { x: width * 0.25, y: -height * 0.65, width: width * 0.4, height },
    { x: width * 0.25, y: 16, width: width * 0.4, height: height - 32 },
  ]
  const videos = [...window.document.querySelectorAll('video')].map((node, i) => {
    node.getBoundingClientRect = () => ({ ...boxes[i], top: boxes[i].y, bottom: boxes[i].y + boxes[i].height,
      left: boxes[i].x, right: boxes[i].x + boxes[i].width }) as DOMRect
    return { boundingBox: async () => boxes[i], evaluate: async <R>(fn: (el: Element) => R) => {
      assert.equal(node.id, 'current', 'the largest visible reel wins over the previous reel preview')
      return fn(node as unknown as Element)
    } }
  })
  let url = 'https://www.instagram.com/reels/current/', wheels = 0, clicks = 0, hovered = false
  const next = { ...visibleActionGeometry, filter() { return this }, first() { return this },
    isVisible: async () => options.nextVisible !== false, isEnabled: async () => options.nextEnabled !== false,
    elementHandle: async () => ({ ...visibleActionGeometry,
      hover: async () => { hovered = true },
      click: async () => { assert.ok(hovered); clicks++; if (options.changeOnClick !== false) url = 'https://www.instagram.com/reels/next/' },
      dispose: async () => {},
    }),
  }
  const page = { url: () => url, viewportSize: () => options.fixedViewport !== false ? { width, height } : null,
    evaluate: async (fn: () => unknown) => window.eval(`(${fn.toString()})()`),
    locator: () => ({ count: async () => videos.length, nth: (i: number) => videos[i] }),
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
  return { window, page, session, boxes, stats: () => ({ wheels, clicks }) }
}

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

test('reels advance directly through the named Next button with cursor movement and no wheel input', async () => {
  const fixture = reelAdvanceFixture(1024, 600)
  try {
    assert.equal(await advanceReel(fixture.page, fixture.session), true)
    assert.equal(fixture.stats().clicks, 1)
    assert.equal(fixture.stats().wheels, 0)
  } finally { await fixture.window.happyDOM.close() }
})

test('an unavailable Next button fails without wheel input or clicking', async () => {
  const fixture = reelAdvanceFixture(1024, 600, { nextVisible: false })
  try {
    assert.equal(await advanceReel(fixture.page, fixture.session), false)
    assert.equal(fixture.stats().clicks, 0)
    assert.equal(fixture.stats().wheels, 0)
  } finally { await fixture.window.happyDOM.close() }
})

test('a changed reel URL waits for the visible video to finish centering', async () => {
  const fixture = reelAdvanceFixture(1024, 600)
  fixture.boxes[1].y = 330
  let settlingWaits = 0
  fixture.session.wait = async () => {
    fixture.session.check()
    if (fixture.stats().clicks && ++settlingWaits === 2) fixture.boxes[1].y = 16
  }
  try {
    assert.equal(await advanceReel(fixture.page, fixture.session), true)
    assert.equal(settlingWaits, 2)
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
  ? 'followed off-topic reels are watched even with a 100% random skip chance'
  : 'reels stay passive even with previously active settings and unused like allowance', async () => {
  const window = new Window(), originalNow = Date.now
  let now = originalNow()
  const start = now
  Date.now = () => now
  try {
    window.document.body.innerHTML = `<main><section><div id="current-reel"><div><a href="/author/reels/">author</a>${followed ? '' : '<button>Follow</button>'}</div>
      <video></video><p>${followed ? 'Cooking dinner' : 'Barbell squats and progressive overload'}</p></div>
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
    const budget = new WarmupActivityBudget({ likes: 6, profiles: 2, reels: 1, stories: 0 })
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
    assert.equal(decisions, followed ? 0 : 1)
    assert.equal(budget.used.likes, 0)
    assert.equal(budget.used.reels, 1)
    assert.ok(now - start >= 6000)
  } finally { Date.now = originalNow; await window.happyDOM.close() }
})
