import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright-core'
import { Window } from 'happy-dom'
import { visibleProfileReels, watchProfileReels } from './profile-reels.js'
import { BrowseSession, SessionEnded } from './session.js'
import { visibleActionGeometry } from './action-locator.test-support.js'

const tileHtml = (id: string, views: string) => '<a href="/alice/reel/' + id + '/"><div>999999 likes</div><div><div><svg aria-label="View Count Icon"></svg></div><span>' + views + '</span></div></a>'

test('profile view badges parse independently of hover counts and skip offscreen/invalid tiles', async () => {
  const window = new Window({ width: 1280, height: 800 })
  try {
    window.document.body.innerHTML = tileHtml('a', '6,897') + tileHtml('b', '122K') + tileHtml('c', '1.2M') +
      tileHtml('offscreen', '9B') + tileHtml('invalid', 'Unknown')
    const links = [...window.document.querySelectorAll('a')]
    for (const link of links) link.querySelector('svg')!.getBoundingClientRect = () => ({
      width: 16, height: 16, left: 100, right: 116, top: link.getAttribute('href')!.includes('offscreen') ? 900 : 100, bottom: 916,
    }) as DOMRect
    assert.deepEqual(visibleProfileReels(links as unknown as Element[]).map(item => item.views), [6897, 122000, 1200000])
  } finally { await window.happyDOM.close() }
})

for (const mode of ['one', 'three', 'expiry'] as const)
  test('profile visit watches the highest-view sampled Reels and closes each via X: ' + mode, async () => {
    const window = new Window({ width: 1280, height: 800 }), originalNow = Date.now, originalRandom = Math.random
    let now = originalNow(), offset = 0, url = 'https://www.instagram.com/alice/reels/', started = now
    Date.now = () => now; Math.random = () => mode === 'one' ? 0 : 0.9
    const gridUrl = url, opened: string[] = [], closed: string[] = [], liked: string[] = [], unmuted: string[] = []
    window.document.body.innerHTML = '<main>' + tileHtml('a', '10K') + tileHtml('b', '20K') + tileHtml('c', '122K') +
      tileHtml('d', '30K') + tileHtml('future', '9M') + '</main>'
    const positions = [0, 200, 850, 1050, 100000]
    for (const [index, node] of [...window.document.querySelectorAll('main a')].entries()) {
      node.getBoundingClientRect = () => ({ x: 200, y: positions[index]! - offset, width: 300, height: 200,
        left: 200, right: 500, top: positions[index]! - offset, bottom: positions[index]! - offset + 200 }) as DOMRect
      node.querySelector('svg')!.getBoundingClientRect = () => ({ width: 16, height: 16, left: 220, right: 236,
        top: positions[index]! - offset + 180, bottom: positions[index]! - offset + 196 }) as DOMRect
    }
    const document = window.document
    type Node = ReturnType<typeof document.querySelector>
    const action = async (node: Node) => {
      assert.ok(node)
      if (node.tagName === 'A') {
        assert.equal(document.querySelector('[role="dialog"]'), null, 'previous viewer must be closed first')
        const id = node.getAttribute('href')!.split('/').at(-2)!
        opened.push(id); url = 'https://www.instagram.com/reel/' + id + '/'; started = now
        document.body.insertAdjacentHTML('beforeend', '<div role="dialog"><article><video></video><svg aria-label="Audio is muted"></svg></article></div><button id="close"><svg aria-label="Close"></svg></button>')
        const video = document.querySelector('video')!
        Object.defineProperties(video, { duration: { value: 4 }, currentTime: { get: () => (now - started) / 1000 },
          paused: { value: false }, ended: { value: false } })
        if (mode === 'expiry') now += 120000
      } else if (node.getAttribute('aria-label') === 'Audio is muted') {
        unmuted.push(opened.at(-1)!); node.setAttribute('aria-label', 'Audio is playing')
      } else {
        assert.equal(node.getAttribute('aria-label'), 'Close')
        closed.push(opened.at(-1)!); document.querySelector('[role="dialog"]')!.remove(); document.querySelector('#close')!.remove(); url = gridUrl
      }
    }
    const locate = (resolve: () => Node): Locator => ({
      ...visibleActionGeometry, first() { return this }, last() { return this }, filter() { return this },
      locator: (selector: string) => locate(() => resolve()?.querySelector(selector) ?? null),
      evaluate: async (fn: (node: Element) => unknown) => fn(resolve() as unknown as Element),
      evaluateAll: async (fn: (nodes: Element[]) => unknown) => fn(resolve() ? [resolve() as unknown as Element] : []),
      count: async () => Number(!!resolve()), isVisible: async () => !!resolve(),
      boundingBox: async () => resolve()?.getBoundingClientRect() ?? null,
      waitFor: async ({ state }: { state: string }) => { assert.equal(!!resolve(), state === 'visible') },
      elementHandle: async () => ({ ...visibleActionGeometry, hover: async () => {}, dispose: async () => {}, click: async () => action(resolve()) }),
    }) as unknown as Locator
    const page = { url: () => url, viewportSize: () => ({ width: 1280, height: 800 }),
      locator: (selector: string) => selector === 'main a[href*="/reel/"]' ? {
        count: async () => 5, evaluateAll: async (fn: (nodes: Element[]) => unknown) => fn([...document.querySelectorAll(selector)] as unknown as Element[]),
      } : locate(() => document.querySelector(selector)),
      getByRole: () => locate(() => document.querySelector('[role="dialog"]')),
      mouse: { move: async () => {}, wheel: async (_x: number, y: number) => { assert.equal(url, gridUrl); offset += y } },
      waitForURL: async (expected: string) => { assert.equal(url, expected) },
    } as unknown as Page
    const parent = new BrowseSession(now + 180000), session = new BrowseSession(now + 60000)
    parent.wait = session.wait = async ms => { now += ms; session.check() }
    try {
      const run = watchProfileReels(page, session, parent, () => {}, async article => {
        assert.equal(await article.locator('video').count(), 1); liked.push(opened.at(-1)!)
      })
      if (mode === 'expiry') await assert.rejects(run, SessionEnded)
      else await run
      assert.deepEqual(opened, mode === 'three' ? ['c', 'd', 'b'] : ['c'])
      assert.deepEqual(closed, opened, 'even a visit deadline must close the dialog using X')
      assert.deepEqual(liked, mode === 'expiry' ? [] : opened)
      assert.deepEqual(unmuted, mode === 'expiry' ? [] : opened)
      assert.equal(url, gridUrl)
      assert.equal(document.querySelectorAll('[data-igbot-action-target]').length, 0)
    } finally { Date.now = originalNow; Math.random = originalRandom; await window.happyDOM.close() }
  })
