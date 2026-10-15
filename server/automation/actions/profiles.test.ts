import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright-core'
import { Window } from 'happy-dom'
import { visitAuthorProfile } from './profiles.js'
import { BrowseSession } from './session.js'
import { visibleActionGeometry } from './action-locator.test-support.js'

for (const native of [false, true]) for (const expiresWhileOpening of [false, true])
  test(`author grid browsing restores the exact Reel (native=${native}, expired=${expiresWhileOpening})`, async () => {
    const window = new Window(), originalNow = Date.now, originalRandom = Math.random
    let now = originalNow(), url = 'https://www.instagram.com/reels/current/', returns = 0, wheels = 0
    const previous = url, start = now
    Date.now = () => now; Math.random = () => 0.1
    const profile = native ? 'https://www.instagram.com/alice/reels/' : 'https://www.instagram.com/alice/'
    window.document.body.innerHTML = '<a href="/alice/reels/">alice</a>'
    const link = window.document.querySelector('a')!
    const author = { ...visibleActionGeometry, first() { return this }, getAttribute: async () => link.getAttribute('href'),
      evaluate: async (fn: (node: Element) => unknown) => fn(link as unknown as Element),
      isVisible: async () => true,
      elementHandle: async () => ({ ...visibleActionGeometry, hover: async () => {}, dispose: async () => {},
        click: async () => { url = profile; if (expiresWhileOpening) now = start + 21_000 },
      }),
    }
    const target = { locator: () => author } as unknown as Locator
    const restore = async () => { assert.equal(url, profile); returns++; url = previous }
    const page = { url: () => url, viewportSize: () => ({ width: 1280, height: 800 }),
      locator: (selector: string) => selector.startsWith('[data-igbot-action-target=')
        ? { ...author, evaluateAll: async () => {} }
        : selector === 'main header' ? { waitFor: async () => {} }
          : selector.startsWith('main a') ? { first() { return this }, isVisible: async () => true }
            : { filter: () => ({ evaluateAll: async () => null }) },
      mouse: { move: async () => {}, wheel: async () => { assert.equal(url, profile); wheels++ } },
      keyboard: { press: async (key: string) => { assert.equal(native, false); assert.equal(key, 'Alt+ArrowLeft'); await restore() } },
      waitForURL: async (expected: string) => { assert.equal(expected, previous); assert.equal(url, previous) },
    } as unknown as Page
    const parent = new BrowseSession(now + 60_000)
    parent.wait = async ms => { now += ms; parent.check() }
    try {
      await visitAuthorProfile(page, target, () => {}, parent, native ? async timeout => {
        assert.ok(timeout > 0 && timeout <= 5000); await restore()
      } : undefined)
      assert.equal(returns, 1); assert.equal(url, previous)
      assert.equal(wheels > 0, !expiresWhileOpening)
      assert.ok(now - start < 26_000)
    } finally { Date.now = originalNow; Math.random = originalRandom; await window.happyDOM.close() }
  })
