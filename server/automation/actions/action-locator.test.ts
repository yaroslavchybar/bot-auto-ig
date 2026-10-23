import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import type { Locator, Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { actionLocator, clickAction, clickLiveAction } from './action-locator.js'
import { BrowseSession, SessionEnded } from './session.js'
import { visibleActionGeometry } from './action-locator.test-support.js'

for (const method of ['click', 'dblclick', 'fill', 'hover'] as const) for (const change of ['reorder', 'replace'] as const)
  test(`${method} keeps selected identity when matching siblings ${change}`, async () => {
    const window = new Window()
    const document = window.document
    document.body.innerHTML = '<button id="first">First</button><button id="selected">Selected</button>'
    const selected = document.querySelector('#selected')!
    const inputs: string[] = []
    const locator = (resolve: () => Element | null): Locator => {
      const input = async () => {
        const node = resolve()
        if (!node?.isConnected) throw new errors.TimeoutError('Selected target was removed')
        inputs.push(node.id)
      }
      return {
        waitFor: async () => { assert.ok(resolve()) },
        elementHandle: async () => {
          const node = resolve()!
          return {
            evaluate: async <T, A>(fn: (node: Element, arg: A) => T, arg: A) => fn(node, arg),
            ownerFrame: async () => ({ locator: (selector: string) => locator(() => document.querySelector(selector)) }),
            dispose: async () => {},
          }
        },
        click: input, dblclick: input, fill: input, hover: input,
      } as unknown as Locator
    }
    try {
      const target = locator(() => document.querySelectorAll('button')[1] as unknown as Element)
      const action = await actionLocator(target)
      if (change === 'reorder') selected.parentElement!.prepend(selected)
      else selected.replaceWith(document.createElement('button'))
      const perform = () => method === 'fill' ? action.fill('Hello') : action[method]()
      if (change === 'replace') await assert.rejects(perform(), /Selected target was removed/)
      else await perform()
      assert.deepEqual(inputs, change === 'reorder' ? ['selected'] : [])
      assert.equal(selected.attributes.length, 1, 'temporary identity must be cleaned up')
    } finally { await window.happyDOM.close() }
  })

for (const method of ['click', 'dblclick', 'fill', 'hover'] as const)
  test(`${method} uses the original locator when nested elements share a box`, async () => {
    const window = new Window()
    window.document.body.innerHTML = '<a href="/alice/p/post/"><img src="post.jpg"></a>'
    const link = window.document.querySelector('a')!, image = link.firstElementChild!
    const box = { x: 100, y: 100, width: 300, height: 400 } as DOMRect
    link.getBoundingClientRect = image.getBoundingClientRect = () => box
    let inputs = 0
    const input = async function(this: unknown) {
      assert.equal(this, target, 'preserve the scoped locator and its receiver')
      assert.equal(link.getBoundingClientRect(), image.getBoundingClientRect())
      inputs++
    }
    const target = {
      ...visibleActionGeometry,
      waitFor: async (options: { state: string }) => { assert.equal(options.state, 'attached') },
      click: input, dblclick: input, fill: input, hover: input,
    } as unknown as Locator
    try {
      const action = await actionLocator(target)
      if (method === 'fill') await action.fill('Hello')
      else await action[method]()
      assert.equal(inputs, 1)
    } finally { await window.happyDOM.close() }
  })

test('missing or ambiguous locators preserve selection failures without starting input', async () => {
  for (const failure of [new errors.TimeoutError('Target missing'), new Error('strict mode violation')]) {
    let clicks = 0
    await assert.rejects(clickAction({
      ...visibleActionGeometry,
      waitFor: async () => { throw failure }, click: async () => { clicks++ },
    } as unknown as Locator), error => error === failure)
    assert.equal(clicks, 0)
  }
})

test('click delegates scrolling and movement to one Cloak action and preserves options', async () => {
  let clicks = 0
  await (await actionLocator({
    ...visibleActionGeometry,
    waitFor: async () => {},
    hover: () => { throw new Error('Must not add a separate cursor action') },
    click: async (options: { timeout: number; button: string; position: object; human_config: object }) => {
      assert.ok(options.timeout > 0 && options.timeout <= 100)
      assert.equal(options.button, 'right')
      assert.deepEqual(options.position, { x: 2, y: 3 })
      assert.deepEqual(options.human_config, { scroll_target_zone: [0, 1] })
      clicks++
    },
  } as unknown as Locator)).click({ timeout: 100, button: 'right', position: { x: 2, y: 3 } })
  assert.equal(clicks, 1)
})

test('an action failure is propagated without retrying another target', async () => {
  const failure = new Error('Browser connection lost')
  let clicks = 0
  const action = await actionLocator({
    ...visibleActionGeometry,
    waitFor: async () => {}, click: async () => { clicks++; throw failure },
  } as unknown as Locator)
  await assert.rejects(action.click(), error => error === failure)
  assert.equal(clicks, 1)
})

test('a failed action removes its marker and disposes selection without masking the error', async () => {
  const window = new Window()
  const node = window.document.createElement('button')
  window.document.body.append(node)
  const failure = new Error('Input failed')
  let disposed = 0
  const target = {
    elementHandle: async () => ({
      ownerFrame: async () => ({ locator: (selector: string) => ({
        click: async () => { assert.equal(window.document.querySelector(selector), node); throw failure },
      }) }),
      evaluate: async <T, A>(fn: (node: Element, arg: A) => T, arg: A) => fn(node as unknown as Element, arg),
      dispose: async () => { disposed++; throw new Error('Page closed during cleanup') },
    }),
  } as unknown as Locator
  try {
    const action = await actionLocator(target)
    assert.equal(node.attributes.length, 1)
    await assert.rejects(action.click(), error => error === failure)
    assert.equal(node.attributes.length, 0)
    assert.equal(disposed, 1)
  } finally { await window.happyDOM.close() }
})

for (const method of ['click', 'dblclick', 'fill', 'hover'] as const)
  test(`selection and ${method} share one deadline and never act after expiry`, async () => {
    const originalNow = Date.now
    let now = 1000, inputs = 0
    Date.now = () => now
    const input = async (options: { timeout: number }) => { inputs++; assert.equal(options.timeout, 60) }
    const target = {
      ...visibleActionGeometry,
      waitFor: async () => { now += 40 }, click: input, dblclick: input, hover: input,
      fill: async (_value: string, options: { timeout: number }) => input(options),
    } as unknown as Locator
    const act = (action: Awaited<ReturnType<typeof actionLocator>>) =>
      method === 'fill' ? action.fill('Hi', { timeout: 1100 - now }) : action[method]({ timeout: 1100 - now })
    try {
      await act(await actionLocator(target, 100))
      assert.equal(inputs, 1)
      now = 1000
      const expired = await actionLocator(target, 100)
      now = 1100
      await assert.rejects(act(expired), /timed out/)
      assert.equal(inputs, 1)
    } finally { Date.now = originalNow }
  })

test('explicit zero timeout remains unlimited', async () => {
  await clickAction({
    ...visibleActionGeometry,
    waitFor: async (options: { timeout: number }) => { assert.equal(options.timeout, 0) },
    click: async (options: { timeout: number }) => { assert.equal(options.timeout, 0) },
  } as unknown as Locator, 0)
})

for (const ending of ['stop', 'deadline'] as const)
  test(`live clicks recheck the session after asynchronous selection (${ending})`, async () => {
    const originalNow = Date.now
    let now = 1000, stopped = false, clicks = 0
    Date.now = () => now
    let select!: () => void
    const selected = new Promise<void>(resolve => { select = resolve })
    const target = { ...visibleActionGeometry, waitFor: () => selected, click: async () => { clicks++ } } as unknown as Locator
    const session = new BrowseSession(2000, () => stopped)
    try {
      const pending = clickLiveAction({} as Page, target, session)
      if (ending === 'deadline') now = 2000
      else stopped = true
      select()
      await assert.rejects(pending, SessionEnded)
      assert.equal(clicks, 0)
    } finally { Date.now = originalNow }
  })

for (const [maxTimeout, sessionMs, expected] of [[undefined, 30_000, 5000], [10_000, 30_000, 10_000], [10_000, 3000, 3000]] as const)
  test(`scoped live clicks preserve the session budget (${maxTimeout}, ${sessionMs})`, async () => {
    const originalNow = Date.now
    Date.now = () => 1000
    let clicks = 0
    const target = {
      ...visibleActionGeometry,
      waitFor: async (options: { timeout: number }) => { assert.equal(options.timeout, expected) },
      click: async (options: { timeout: number; human_config: object }) => {
        assert.equal(options.timeout, expected)
        assert.deepEqual(options.human_config, { scroll_target_zone: [0, 1], mouse_overshoot_chance: 0 })
        clicks++
      },
    } as unknown as Locator
    try {
      await clickLiveAction({} as Page, target, new BrowseSession(1000 + sessionMs), maxTimeout)
      assert.equal(clicks, 1)
      await assert.rejects(clickLiveAction({} as Page, target, new BrowseSession(1000), maxTimeout), /session ended/)
      assert.equal(clicks, 1)
    } finally { Date.now = originalNow }
  })
