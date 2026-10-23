import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { Window } from 'happy-dom'
import { visitAuthorProfile } from './profiles.js'
import { BrowseSession } from './session.js'
import { visibleActionGeometry } from './action-locator.test-support.js'

for (const native of [false, true]) for (const expiresWhileOpening of [false, true])
  test(`author grid browsing restores the exact Reel (native=${native}, expired=${expiresWhileOpening})`, async () => {
    const window = new Window(), originalNow = Date.now, originalRandom = Math.random
    let now = originalNow(), url = 'https://www.instagram.com/reels/current/', returns = 0
    const previous = url, start = now
    const history = [previous]
    Date.now = () => now; Math.random = () => 0.1
    const profile = native ? 'https://www.instagram.com/alice/reels/' : 'https://www.instagram.com/alice/'
    window.document.body.innerHTML = '<a href="/alice/reels/">alice</a>'
    const link = window.document.querySelector('a')!
    const author = { ...visibleActionGeometry, first() { return this }, getAttribute: async () => link.getAttribute('href'),
      evaluate: async (fn: (node: Element) => unknown) => fn(link as unknown as Element),
      isVisible: async () => true,
      hover: async () => {}, click: async () => { url = profile; history.push(url); if (expiresWhileOpening) now = start + 121_000 },
    }
    const tab = { ...author, ...visibleActionGeometry, hover: async () => {}, click: async () => { url = 'https://www.instagram.com/alice/reels/'; history.push(url) } }
    const target = { locator: () => author } as unknown as Locator
    const restore = async () => { returns++; history.pop(); url = history.at(-1)! }
    const page = { url: () => url, viewportSize: () => ({ width: 1280, height: 800 }),
      locator: (selector: string) => selector.startsWith('[data-igbot-action-target=')
        ? { ...(history.length === 2 && !native && !expiresWhileOpening ? tab : author), evaluateAll: async () => {} }
        : selector === 'main header' ? { waitFor: async () => {} }
          : selector === 'main a[href="/alice/reels/"]' ? tab
            : selector.startsWith('main a') ? { first() { return this }, count: async () => 0, evaluateAll: async () => [],
              waitFor: async () => { throw new errors.TimeoutError('No Reels') } }
            : { filter: () => ({ evaluateAll: async () => null }) },
      context: () => ({ newCDPSession: async () => ({ send: async (command: string, input: { type: string; button: string }) => {
        assert.equal(command, 'Input.dispatchMouseEvent'); assert.equal(input.button, 'back'); if (input.type === 'mouseReleased') await restore()
      }, detach: async () => {} }) }),
      keyboard: { press: async () => { throw new Error('Back must use a mouse button') } },
      waitForURL: async (expected: string) => { assert.equal(url, expected) },
    } as unknown as Page
    const parent = new BrowseSession(now + 180_000)
    parent.wait = async ms => { now += ms; parent.check() }
    try {
      await visitAuthorProfile(page, target, () => {}, parent, native ? async timeout => {
        assert.ok(timeout > 0 && timeout <= 5000); await restore()
      } : undefined)
      assert.equal(returns, !native && !expiresWhileOpening ? 2 : 1); assert.equal(url, previous)
      assert.ok(now - start < 130_000)
    } finally { Date.now = originalNow; Math.random = originalRandom; await window.happyDOM.close() }
  })
