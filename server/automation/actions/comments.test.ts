import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright-core'
import { Window } from 'happy-dom'
import { commentScrollBounds, readPostComments } from './comments.js'
import { BrowseSession, SessionEnded } from './session.js'
import { visibleActionGeometry } from './action-locator.test-support.js'

for (const mode of ['normal', 'empty', 'expiry', 'cancelled'] as const)
  test('comments read and close via X: ' + mode, async () => {
    const window = new Window({ width: 1280, height: 800 }), originalNow = Date.now, originalRandom = Math.random
    let now = originalNow(), open = false, stopped = false, wheels = 0, closes = 0
    Date.now = () => now; Math.random = () => 0.5
    window.document.body.innerHTML = '<button><svg aria-label="Comment"></svg></button>' +
      '<div role="dialog"><button><svg aria-label="Close"></svg></button><div id="list" style="overflow-y:auto"><a href="/p/current/c/123/">Comment</a></div><textarea></textarea></div>'
    const document = window.document, panelNode = document.querySelector('[role="dialog"]')!, list = document.querySelector('#list')!
    list.getBoundingClientRect = () => ({ left: 800, right: 1200, top: 150, bottom: 450, width: 400, height: 300 }) as DOMRect
    Object.defineProperties(list, { clientHeight: { value: 300 }, scrollHeight: { value: mode === 'empty' ? 300 : 3000 } })
    const locator = (node: typeof list | null): Locator => ({
      ...visibleActionGeometry, first() { return this },
      locator: (selector: string) => locator(node?.querySelector(selector) ?? null),
      evaluate: async (fn: (element: Element) => unknown) => fn(node as unknown as Element),
      evaluateAll: async (fn: (elements: Element[]) => unknown) => fn(node ? [node as unknown as Element] : []),
      isVisible: async () => node === panelNode ? open : !!node,
      waitFor: async ({ state }: { state: string }) => { assert.equal(open, state === 'visible') },
      elementHandle: async () => ({ ...visibleActionGeometry, hover: async () => {}, dispose: async () => {},
        click: async () => {
          const label = node?.getAttribute('aria-label')
          if (label === 'Comment') open = true
          else { assert.equal(label, 'Close'); open = false; closes++ }
        },
      }),
    }) as unknown as Locator
    const panel = locator(panelNode)
    const page = { url: () => 'https://www.instagram.com/reels/current/', viewportSize: () => ({ width: 1280, height: 800 }),
      locator: (selector: string) => selector.startsWith('[data-igbot-action-target=') ? locator(document.querySelector(selector))
        : { filter: () => ({ evaluateAll: async () => null }) },
      getByRole: () => ({ filter() { return this }, last: () => panel }),
      mouse: { move: async (x: number, y: number) => { assert.ok(x > 800 && x < 1200 && y > 150 && y < 450) },
        wheel: async (_x: number, y: number) => { assert.ok(open); wheels++; list.scrollTop += y } },
      keyboard: { press: async () => { throw new Error('Must use the close button') } },
    } as unknown as Page
    const session = new BrowseSession(now + 60_000, () => stopped)
    session.wait = async ms => { now += mode === 'expiry' ? 16_000 : ms; stopped = mode === 'cancelled'; session.check() }
    try {
      const run = readPostComments(page, locator(document.querySelector('body > button')), session)
      if (mode === 'expiry' || mode === 'cancelled') await assert.rejects(run, SessionEnded)
      else await run
      assert.equal(closes, mode === 'cancelled' ? 0 : 1)
      assert.equal(wheels > 0, mode === 'normal')
      assert.equal(document.querySelectorAll('[data-igbot-action-target]').length, 0)
      assert.equal(document.querySelector('textarea')!.value, '')
    } finally { Date.now = originalNow; Math.random = originalRandom; await window.happyDOM.close() }
  })

test('comment scrolling ignores hidden scrollports and stops at the list end', async () => {
  const window = new Window({ width: 1280, height: 800 })
  try {
    window.document.body.innerHTML = '<div id="panel"><div style="overflow-y:auto" id="hidden"></div><ul style="overflow-y:auto"></ul></div>'
    const list = window.document.querySelector('ul')!, hidden = window.document.querySelector('#hidden')!
    for (const node of [hidden, list]) Object.defineProperties(node, { clientHeight: { value: 300 }, scrollHeight: { value: 600 } })
    list.getBoundingClientRect = () => ({ left: 700, right: 1100, top: 100, bottom: 400 }) as DOMRect
    list.scrollTop = 300
    const bounds = commentScrollBounds(window.document.querySelector('#panel')! as unknown as Element)
    assert.deepEqual(bounds, { left: 700, right: 1100, top: 100, bottom: 400, atEnd: true })
  } finally { await window.happyDOM.close() }
})
