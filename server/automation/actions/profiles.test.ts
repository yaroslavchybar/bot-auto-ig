import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright-core'
import { visitAuthorProfile } from './profiles.js'
import { BrowseSession } from './session.js'
import { visibleActionGeometry } from './action-locator.test-support.js'

for (const expiresWhileOpening of [false, true])
  test(`matched-author visit restores the exact Reel, including local opening expiry (${expiresWhileOpening})`, async () => {
    const originalNow = Date.now, originalTimeout = globalThis.setTimeout
    let now = originalNow(), url = 'https://www.instagram.com/reels/current/', returns = 0
    const previous = url, start = now
    Date.now = () => now
    globalThis.setTimeout = ((callback: (...args: any[]) => void, ms?: number, ...args: any[]) =>
      originalTimeout(() => { now += ms ?? 0; callback(...args) }, 0)) as typeof setTimeout
    const author = { ...visibleActionGeometry, first() { return this }, getAttribute: async () => '/alice/',
      isVisible: async () => true,
      elementHandle: async () => ({ ...visibleActionGeometry, hover: async () => {}, dispose: async () => {},
        click: async () => { url = 'https://www.instagram.com/alice/'; if (expiresWhileOpening) now = start + 16_000 },
      }),
    }
    const target = { locator: () => author } as unknown as Locator
    const page = { url: () => url, viewportSize: () => ({ width: 1280, height: 800 }),
      locator: (selector: string) => selector === 'main header' ? { waitFor: async () => {} }
        : { filter: () => ({ evaluateAll: async () => null }) },
      keyboard: { press: async (key: string) => { assert.equal(key, 'Alt+ArrowLeft'); returns++; url = previous } },
      waitForURL: async (expected: string) => { assert.equal(expected, previous); assert.equal(url, previous) },
    } as unknown as Page
    try {
      await visitAuthorProfile(page, target, () => {}, new BrowseSession(now + 60_000))
      assert.equal(returns, 1); assert.equal(url, previous)
      assert.ok(now - start < 20_000)
    } finally { Date.now = originalNow; globalThis.setTimeout = originalTimeout }
  })
