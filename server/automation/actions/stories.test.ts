import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errors, type Page } from 'playwright-core'
import { watchStories, UNSEEN_STORY_SELECTOR } from './stories.js'
import { visibleActionGeometry } from './action-locator.test-support.js'

async function fixture(options: { missing?: boolean; budgetMs?: number; autoplay?: boolean; seenNext?: boolean; stopDuringView?: boolean } = {}) {
  const originalNow = Date.now, originalTimeout = globalThis.setTimeout
  let now = originalNow(), opened = false, stopped = false, nextClicks = 0, closed = 0, index = 0, waits = 0
  const start = now, budgetMs = options.budgetMs ?? 95
  const frames = options.autoplay ? ['alice/1/', 'bob/2/'] : options.seenNext ? ['alice/1/', 'already_seen/2/']
    : Array.from({ length: 20 }, (_, i) => `alice/${i + 1}/`)
  const owners = options.autoplay ? ['alice', 'bob'] : ['alice']
  Date.now = () => now
  globalThis.setTimeout = ((callback: (...args: any[]) => void, ms?: number, ...args: any[]) => originalTimeout(() => {
    now += ms ?? 0
    if (options.autoplay && waits++ === 0) index = 1
    if (options.stopDuringView) stopped = true
    callback(...args)
  }, 0)) as typeof setTimeout
  const story = { ...visibleActionGeometry, first() { return this }, evaluateAll: async () => owners,
    isVisible: async () => !options.missing,
    waitFor: async ({ timeout }: { timeout: number }) => {
      assert.ok(timeout <= 2000)
      if (options.missing) throw new errors.TimeoutError('No unseen stories')
    },
    elementHandle: async () => ({ ...visibleActionGeometry, hover: async () => {},
      click: async () => { opened = true }, dispose: async () => {} }),
  }
  const next = { ...visibleActionGeometry, page: () => page, isVisible: async () => true,
    elementHandle: async () => ({ ...visibleActionGeometry, hover: async () => {},
      click: async () => { nextClicks++; index++ }, dispose: async () => {} }),
  }
  const page = { viewportSize: () => ({ width: 1280, height: 800 }),
    url: () => opened ? `https://www.instagram.com/stories/${frames[index]}` : 'https://www.instagram.com/',
    waitForURL: async (accept: (url: URL) => boolean) => { if (!accept(new URL(page.url()))) throw new errors.TimeoutError('Story did not advance') },
    keyboard: { press: async (key: string) => { assert.equal(key, 'Escape'); if (opened) closed++ } },
    locator: (selector: string) => {
      if (selector.includes('Story by')) { assert.ok(selector.startsWith(UNSEEN_STORY_SELECTOR)); return story }
      if (selector.includes('Next')) return { count: async () => index < frames.length - 1 ? 1 : 0, nth: () => next }
      return { count: async () => 0, filter: () => ({ evaluateAll: async () => null }) }
    },
  } as unknown as Page
  try {
    const watched = await watchStories(page, Infinity, () => {}, () => stopped, {
      minSeconds: 0.01, maxSeconds: 0.01, deadline: start + budgetMs,
    })
    return { watched, nextClicks, closed, opened, elapsed: now - start }
  } finally { Date.now = originalNow; globalThis.setTimeout = originalTimeout }
}

test('no unseen stories returns immediately without opening the tray or spending the viewing window', async () => {
  const result = await fixture({ missing: true, budgetMs: 180_000 })
  assert.equal(result.watched, 0)
  assert.equal(result.opened, false)
  assert.equal(result.elapsed, 0)
})

test('story watching is time-bounded instead of stopping at three stories', async () => {
  const result = await fixture()
  assert.ok(result.watched > 3)
  assert.equal(result.elapsed, 95)
  assert.equal(result.closed, 1)
})

test('autoplay advancement does not click Next and the final story ends the phase early', async () => {
  const result = await fixture({ autoplay: true, budgetMs: 180_000 })
  assert.equal(result.watched, 2)
  assert.equal(result.nextClicks, 0)
  assert.equal(result.elapsed, 20)
  assert.equal(result.closed, 1)
})

test('an account already seen before opening never gets viewing time after advancing to it', async () => {
  const result = await fixture({ seenNext: true, budgetMs: 180_000 })
  assert.equal(result.watched, 1)
  assert.equal(result.elapsed, 10)
  assert.equal(result.closed, 1)
})

test('a stop during viewing closes the viewer without counting an unfinished story', async () => {
  const result = await fixture({ stopDuringView: true })
  assert.equal(result.watched, 0)
  assert.equal(result.closed, 1)
})
