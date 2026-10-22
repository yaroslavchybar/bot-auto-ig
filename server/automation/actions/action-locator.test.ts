import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import type { ElementHandle, Locator, Page } from 'playwright-core'
import { actionLocator, clickAction, clickLiveAction } from './action-locator.js'
import { BrowseSession, SessionEnded } from './session.js'

for (const method of ['click', 'dblclick', 'fill', 'hover'] as const)
  test(`${method} remains bound after siblings shift and fails when its element is replaced`, async () => {
    const window = new Window()
    window.document.body.innerHTML = '<button>First</button><button>Selected</button>'
    const selected = window.document.querySelectorAll('button')[1]!
    const events: string[] = []
    let disposed = 0
    const input = async (value: string) => { assert.ok(selected.isConnected, 'detached'); events.push(value) }
    const target = { elementHandle: async () => ({
      click: () => input('click'), dblclick: () => input('dblclick'), hover: () => input('hover'), fill: input,
      dispose: async () => { disposed++ },
    }) } as unknown as Locator
    const act = (action: Awaited<ReturnType<typeof actionLocator>>) =>
      method === 'fill' ? action.fill('Hello') : action[method]()
    try {
      const action = await actionLocator(target)
      selected.previousElementSibling!.remove()
      await act(action)
      assert.deepEqual(events, [method === 'fill' ? 'Hello' : method])
      assert.equal(disposed, 1)
      const next = await actionLocator(target)
      selected.replaceWith(window.document.createElement('button'))
      await assert.rejects(act(next), /detached/)
      assert.equal(events.length, 1, 'replacement must not receive input')
      assert.equal(disposed, 2)
    } finally { await window.happyDOM.close() }
  })

test('a missing element fails before an action can be created', async () => {
  await assert.rejects(actionLocator({ elementHandle: async () => null } as unknown as Locator), /detached or missing/)
})

test('click delegates scrolling and cursor movement to one Cloak action and preserves options', async () => {
  let disposed = false, clicks = 0
  await (await actionLocator({ elementHandle: async () => ({
    ownerFrame: () => { throw new Error('Must not manually scroll the target') },
    hover: () => { throw new Error('Must not add a separate cursor action') },
    click: async (options: { timeout: number; button: string; position: object; human_config: object }) => {
      assert.ok(options.timeout > 0 && options.timeout <= 100)
      assert.equal(options.button, 'right')
      assert.deepEqual(options.position, { x: 2, y: 3 })
      assert.deepEqual(options.human_config, { scroll_target_zone: [0, 1] })
      clicks++
    }, dispose: async () => { disposed = true },
  }) } as unknown as Locator)).click({ timeout: 100, button: 'right', position: { x: 2, y: 3 } })
  assert.equal(clicks, 1)
  assert.equal(disposed, true)
})

test('handle cleanup does not hide the original action error', async () => {
  const failure = new Error('Target detached')
  const action = await actionLocator({ elementHandle: async () => ({
    click: async () => { throw failure }, dispose: async () => { throw new Error('Page closed') },
  }) } as unknown as Locator)
  await assert.rejects(action.click(), error => error === failure)
})

for (const method of ['click', 'dblclick', 'fill', 'hover'] as const)
  test(`selection and ${method} share one deadline and dispose expired handles`, async () => {
    const originalNow = Date.now
    let now = 1000, inputs = 0, disposed = 0
    Date.now = () => now
    const action = async (options: { timeout: number }) => { inputs++; assert.equal(options.timeout, 60) }
    const target = { elementHandle: async () => {
      now += 40
      return { click: action, dblclick: action, hover: action, fill: async (_v: string, options: { timeout: number }) => action(options),
        dispose: async () => { disposed++ } }
    } } as unknown as Locator
    const act = (pinned: Awaited<ReturnType<typeof actionLocator>>) =>
      method === 'fill' ? pinned.fill('Hi', { timeout: 1100 - now }) : pinned[method]({ timeout: 1100 - now })
    try {
      await act(await actionLocator(target, 100))
      assert.equal(inputs, 1); assert.equal(disposed, 1)
      now = 1000
      const expired = await actionLocator(target, 100)
      now = 1100
      await assert.rejects(act(expired), /timed out/)
      assert.equal(inputs, 1); assert.equal(disposed, 2)
    } finally { Date.now = originalNow }
  })

test('explicit zero timeout remains unlimited', async () => {
  await clickAction({ elementHandle: async () => ({
    click: async (options: { timeout: number }) => { assert.equal(options.timeout, 0) }, dispose: async () => {},
  }) } as unknown as Locator, 0)
})

for (const ending of ['stop', 'deadline', 'cleanup failure'] as const)
  test(`live clicks recheck the session after asynchronous selection (${ending})`, async () => {
    const originalNow = Date.now
    let now = 1000, stopped = false, clicks = 0, disposed = 0
    Date.now = () => now
    let select!: (handle: ElementHandle) => void
    const selected = new Promise<ElementHandle>(resolve => { select = resolve })
    const target = { elementHandle: () => selected } as unknown as Locator
    const session = new BrowseSession(2000, () => stopped)
    try {
      const pending = clickLiveAction({} as Page, target, session)
      if (ending === 'deadline') now = 2000
      else stopped = true
      select({ click: async () => { clicks++ }, dispose: async () => {
        disposed++
        if (ending === 'cleanup failure') throw new Error('Page closed during cleanup')
      } } as unknown as ElementHandle)
      await assert.rejects(pending, SessionEnded)
      assert.equal(clicks, 0)
      assert.equal(disposed, 1)
    } finally { Date.now = originalNow }
  })

for (const [maxTimeout, sessionMs, expected] of [[undefined, 30_000, 5000], [10_000, 30_000, 10_000], [10_000, 3000, 3000]] as const)
  test(`scoped live clicks use the original locator without DOM markers (${maxTimeout}, ${sessionMs})`, async () => {
    const originalNow = Date.now
    Date.now = () => 1000
    let clicks = 0
    const forbidden = () => { throw new Error('Must not rewrite DOM or resolve a surrogate selector') }
    const target = { evaluate: forbidden, elementHandle: async (options: { timeout: number }) => {
      assert.equal(options.timeout, expected)
      return { click: async (options: { timeout: number; human_config: object }) => {
        assert.equal(options.timeout, expected)
        assert.deepEqual(options.human_config, { scroll_target_zone: [0, 1], mouse_overshoot_chance: 0 })
        clicks++
      }, dispose: async () => {} }
    } } as unknown as Locator
    try {
      await clickLiveAction({ locator: forbidden } as unknown as Page, target, new BrowseSession(1000 + sessionMs), maxTimeout)
      assert.equal(clicks, 1)
      await assert.rejects(clickLiveAction({} as Page, target, new BrowseSession(1000), maxTimeout), /session ended/)
      assert.equal(clicks, 1)
    } finally { Date.now = originalNow }
  })
