import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { Window } from 'happy-dom'
import { browseLeadPosts, leadPostMediaIndex, visibleLeadPosts } from './lead-posts.js'
import { BrowseSession, SessionEnded } from './session.js'

const box = (width = 400, height = 400, top = 100) => ({ x: 200, y: top, left: 200, right: 200 + width,
  top, bottom: top + height, width, height }) as DOMRect

test('lead grid sampling excludes suggestions, offscreen tiles and other accounts', async () => {
  const window = new Window({ width: 1280, height: 800 })
  try {
    window.document.body.innerHTML = ['/alice/p/a/', '/alice/reel/b/', '/bob/p/c/', '/alice/', '/alice/p/offscreen/']
      .map(href => `<a href="${href}"></a>`).join('')
    const nodes = [...window.document.querySelectorAll('a')]
    for (const node of nodes) node.getBoundingClientRect = () => box(300, 300, node.getAttribute('href')!.includes('offscreen') ? 1000 : 100)
    assert.deepEqual(visibleLeadPosts(nodes as unknown as Element[], 'ALICE'), ['/alice/p/a/', '/alice/reel/b/'])
  } finally { await window.happyDOM.close() }
})

test('main media selection ignores avatars, unloaded images and offscreen carousel slides', async () => {
  const window = new Window({ width: 1280, height: 800 })
  try {
    window.document.body.innerHTML = '<img id="avatar"><img id="loading"><img id="offscreen"><img id="post">'
    const nodes = [...window.document.querySelectorAll('img')]
    for (const node of nodes) {
      Object.defineProperties(node, { complete: { value: node.id !== 'loading' }, naturalWidth: { value: 1000 } })
      node.getBoundingClientRect = () => node.id === 'avatar' ? box(32, 32) : box(486, 647, node.id === 'offscreen' ? 1000 : 100)
    }
    assert.equal(leadPostMediaIndex(nodes as unknown as Element[]), 3)
  } finally { await window.happyDOM.close() }
})

function fixture(mode: 'public' | 'private' | 'empty' = 'public') {
  const window = new Window({ width: 1280, height: 800 }), document = window.document
  const profileUrl = 'https://www.instagram.com/alice/'
  let url = profileUrl, stopped = false
  const calls: string[] = []
  document.body.innerHTML = '<main><header><h2>alice</h2></header>' + (mode === 'private' ? '<span>This profile is private</span>'
    : mode === 'empty' ? '<h1>No posts yet</h1><aside><a href="/other/p/suggested/">Suggestion</a></aside>'
      : '<a href="/alice/p/one/">One</a><a href="/alice/p/two/">Two</a><a href="/alice/reel/three/">Three</a>') + '</main>'
  for (const node of document.querySelectorAll('main a')) node.getBoundingClientRect = () => box()
  type DomElement = NonNullable<ReturnType<typeof document.querySelector>>
  const locate = (resolve: () => DomElement[]): Locator => ({
    first: () => locate(() => resolve().slice(0, 1)), last: () => locate(() => resolve().slice(-1)),
    nth: (i: number) => locate(() => resolve().slice(i, i + 1)), filter() { return this },
    or: (other: Locator) => ({ first: () => ({ waitFor: async () => {
      assert.ok(resolve().length || other, 'must wait for loaded profile')
    } }), or() { return this } }),
    locator: (selector: string) => locate(() => resolve().flatMap(node => [...node.querySelectorAll(selector)])),
    getByText: (text: string | RegExp) => locate(() => resolve().flatMap(node => [...node.querySelectorAll('*')]
      .filter(child => text instanceof RegExp ? text.test(child.textContent) : child.textContent === text))),
    evaluateAll: async (fn: (nodes: Element[], arg: unknown) => unknown, arg: unknown) => fn(resolve() as unknown as Element[], arg),
    evaluate: async (fn: (node: Element) => unknown) => fn(resolve()[0] as unknown as Element),
    getAttribute: async (name: string) => resolve()[0]?.getAttribute(name) ?? null,
    count: async () => resolve().length, isVisible: async () => resolve().length > 0,
    waitFor: async ({ state }: { state: string }) => { assert.equal(resolve().length > 0, state === 'visible') },
  }) as unknown as Locator
  const page = { url: () => url, viewportSize: () => ({ width: 1280, height: 800 }),
    locator: (selector: string) => locate(() => [...document.querySelectorAll(selector)]),
    getByRole: () => locate(() => [...document.querySelectorAll('[role="dialog"]')]),
    mouse: { move: async () => {} },
    waitForURL: async (expected: string) => { assert.equal(url, expected) },
  } as unknown as Page
  const deps: NonNullable<Parameters<typeof browseLeadPosts>[4]> = {
    random: (min, max) => min === 1 && max === 4 ? 3 : min,
    wait: async session => { session.check() },
    check: async () => {}, reveal: async () => true,
    scroll: async () => { calls.push('scroll') },
    video: async () => { calls.push('watch-video'); return true },
    capture: async target => {
      assert.equal(await target.evaluate(node => node.tagName), 'ARTICLE', 'capture the opened post container, as Reels does')
      assert.equal(await target.locator('#media').count(), 1)
      calls.push('capture'); return Buffer.from('jpeg')
    },
    decide: async () => { calls.push('classify'); return { person: true, confidence: 0.9 } },
    like: async (_page, target, budget, session, _log, chance, checkTarget) => {
      session.check(); await checkTarget?.()
      assert.equal(budget, undefined, 'lead Likes have no daily cap')
      assert.equal(chance, 100, 'lead Likes have no random chance')
      assert.equal(await target.locator('svg[aria-label="Comment"]').count(), 1)
      assert.equal(await target.locator('[data-comment-heart]').count(), 0)
      calls.push('like')
    },
    click: async (_page, target) => {
      const href = await target.getAttribute('href')
      if (href) {
        assert.equal(document.querySelector('[role="dialog"]'), null)
        calls.push('open'); url = `https://www.instagram.com/p/${href.split('/').at(-2)}/`
        const video = href.includes('/reel/')
        document.body.insertAdjacentHTML('beforeend', `<div role="dialog"><article><header><a href="/alice/">alice</a></header>` +
          (video ? '<video id="media" src="video.mp4"></video><svg aria-label="Audio is muted"></svg>' : '<img id="media" src="photo.jpg">') +
          '<section><button><svg aria-label="Like"></svg></button><svg aria-label="Comment"></svg></section>' +
          '<ul><li><svg data-comment-heart aria-label="Unlike"></svg></li></ul></article></div><button id="close"><svg aria-label="Close"></svg></button>')
        const media = document.querySelector('#media')!
        media.getBoundingClientRect = () => box(486, 647)
        if (!video) Object.defineProperties(media, { complete: { value: true }, naturalWidth: { value: 1000 } })
      } else if (await target.getAttribute('aria-label') === 'Audio is muted') calls.push('unmute')
      else {
        calls.push('close'); document.querySelector('[role="dialog"]')!.remove(); document.querySelector('#close')!.remove(); url = profileUrl
      }
    },
  }
  const run = () => browseLeadPosts(page, 'alice', new BrowseSession(Date.now() + 120_000, () => stopped), () => {}, deps)
  return { run, deps, calls, document, setUrl: (value: string) => { url = value }, url: () => url,
    stop: () => { stopped = true }, close: () => window.happyDOM.close() }
}

for (const mode of ['private', 'empty'] as const) test(`lead browsing skips ${mode} profiles immediately`, async () => {
  const s = fixture(mode)
  try { await s.run(); assert.deepEqual(s.calls, []) } finally { await s.close() }
})

for (const person of [false, true]) test(`lead posts use their own person decision, close via X and have no Like cap (${person})`, async () => {
  const s = fixture()
  s.deps.decide = async () => { s.calls.push('classify'); return { person, confidence: person ? 0.9 : 0.1 } }
  try {
    await s.run()
    assert.equal(s.calls.filter(c => c === 'open').length, 3)
    assert.equal(s.calls.filter(c => c === 'close').length, 3)
    assert.equal(s.calls.filter(c => c === 'capture').length, 3)
    assert.equal(s.calls.filter(c => c === 'classify').length, 3)
    assert.equal(s.calls.filter(c => c === 'like').length, person ? 3 : 0)
    assert.equal(s.calls.filter(c => c === 'unmute').length, 1)
    assert.equal(s.calls.filter(c => c === 'watch-video').length, 1)
    assert.equal(s.url(), 'https://www.instagram.com/alice/')
  } finally { await s.close() }
})

for (const count of [1, 2, 5]) test(`opens at most three distinct posts from ${count} available posts`, async () => {
  const s = fixture()
  try {
    const main = s.document.querySelector('main')!
    for (const link of [...main.querySelectorAll('a')].slice(count)) link.remove()
    for (let i = 3; i < count; i++) {
      const link = s.document.createElement('a')
      link.setAttribute('href', `/alice/p/extra${i}/`)
      link.getBoundingClientRect = () => box()
      main.appendChild(link)
    }
    await s.run()
    const expected = Math.min(3, count)
    for (const action of ['open', 'capture', 'classify', 'like', 'close'])
      assert.equal(s.calls.filter(call => call === action).length, expected)
    assert.equal(s.url(), 'https://www.instagram.com/alice/')
  } finally { await s.close() }
})

test('provider failures skip Likes and keep closing each post', async () => {
  const s = fixture()
  s.deps.decide = async () => { throw new Error('Provider unavailable') }
  try {
    await s.run(); assert.equal(s.calls.includes('like'), false)
    assert.equal(s.calls.filter(c => c === 'close').length, 3)
  } finally { await s.close() }
})

test('an optional Like timeout does not stop the next lead post', async () => {
  const s = fixture()
  s.deps.like = async () => { s.calls.push('like'); throw new errors.TimeoutError('Unconfirmed') }
  try { await s.run(); assert.equal(s.calls.filter(c => c === 'like').length, 3); assert.equal(s.calls.filter(c => c === 'close').length, 3) }
  finally { await s.close() }
})

test('a post changed during Luna is never liked', async () => {
  const s = fixture()
  s.deps.decide = async () => { s.document.querySelector('#media')!.setAttribute('src', 'different.jpg'); return { person: true, confidence: 1 } }
  try { await s.run(); assert.equal(s.calls.includes('like'), false) } finally { await s.close() }
})

test('cancellation during Luna prevents Like input', async () => {
  const s = fixture()
  s.deps.decide = async () => { s.stop(); return { person: true, confidence: 1 } }
  try { await assert.rejects(s.run(), SessionEnded); assert.equal(s.calls.includes('like'), false) } finally { await s.close() }
})

test('an expired visit still closes its viewer with the parent session', async () => {
  const s = fixture()
  s.deps.wait = async () => { if (s.document.querySelector('[role="dialog"]')) throw new SessionEnded('Visit time used') }
  try {
    await assert.rejects(s.run(), SessionEnded)
    assert.equal(s.calls.filter(c => c === 'close').length, 1)
    assert.equal(s.url(), 'https://www.instagram.com/alice/')
    assert.equal(s.calls.includes('like'), false)
  } finally { await s.close() }
})
