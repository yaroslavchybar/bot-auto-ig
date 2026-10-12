import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import type { Locator } from 'playwright-core'
import { actionLocator, clickAction } from './action-locator.js'
import { ElementNotVisibleError, resolveConfig } from 'cloakbrowser/human'

for (const method of ['click', 'fill', 'hover'] as const) {
  test(`${method} remains bound after siblings shift and fails when its element is replaced`, async () => {
    const window = new Window()
    try {
      window.document.body.innerHTML = '<button>Earlier</button><button>Selected</button><button>Later</button>'
      const selected = window.document.querySelectorAll('button')[1]!
      const events: string[] = []
      let disposed = 0
      const handle = {
        click: async () => { assert.ok(selected.isConnected, 'detached'); events.push('click') },
        fill: async (value: string) => { assert.ok(selected.isConnected, 'detached'); events.push(value) },
        hover: async () => { assert.ok(selected.isConnected, 'detached'); events.push('hover') },
        dispose: async () => { disposed++ },
      }
      const target = {
        elementHandle: async (options: { timeout: number }) => {
          assert.equal(options.timeout, 3210)
          return handle
        },
        page: () => { throw new Error('Must not resolve a page selector') },
      } as unknown as Locator
      const act = (action: Awaited<ReturnType<typeof actionLocator>>) =>
        method === 'fill' ? action.fill('Hello') : action[method]()
      const action = await actionLocator(target, 3210)
      selected.previousElementSibling!.remove()
      await act(action)
      const expected = method === 'click' ? ['hover', 'click'] : [method === 'fill' ? 'Hello' : method]
      assert.deepEqual(events, expected)
      assert.equal(disposed, 1)

      const nextAction = await actionLocator(target, 3210)
      const replacement = window.document.createElement('button')
      replacement.textContent = 'Replacement'
      selected.replaceWith(replacement)
      await assert.rejects(act(nextAction), /detached/)
      assert.equal(events.length, expected.length, 'replacement must not receive the action')
      assert.equal(disposed, 2)
    } finally { await window.happyDOM.close() }
  })
}

test('a missing element fails before an action can be created', async () => {
  await assert.rejects(actionLocator({ elementHandle: async () => null } as unknown as Locator), /detached or missing/)
})

test('handle cleanup does not hide the original action error', async () => {
  const failure = new Error('Target detached')
  const action = await actionLocator({ elementHandle: async () => ({
    hover: async () => {},
    click: async () => { throw failure },
    dispose: async () => { throw new Error('Page closed') },
  }) } as unknown as Locator)
  await assert.rejects(action.click(), error => error === failure)
})

test('failed cursor movement prevents clicking and disposes the pinned handle', async () => {
  const failure = new Error('Target moved behind a dialog')
  let clicks = 0, disposed = false
  const action = await actionLocator({ elementHandle: async () => ({
    hover: async () => { throw failure }, click: async () => { clicks++ },
    dispose: async () => { disposed = true },
  }) } as unknown as Locator)
  await assert.rejects(action.click(), error => error === failure)
  assert.equal(clicks, 0)
  assert.equal(disposed, true)
})

test('cursor movement and clicking share one timeout and keep the requested click options', async () => {
  const originalNow = Date.now
  let now = 1000
  Date.now = () => now
  try {
    const calls: string[] = []
    const action = await actionLocator({ elementHandle: async () => ({
      hover: async (options: { timeout: number; position: { x: number; y: number } }) => {
        assert.equal(options.timeout, 100)
        assert.deepEqual(options.position, { x: 2, y: 3 })
        calls.push('move'); now += 40
      },
      click: async (options: { timeout: number; button: string }) => {
        assert.equal(options.timeout, 60); assert.equal(options.button, 'right'); calls.push('click')
      }, dispose: async () => {},
    }) } as unknown as Locator)
    await action.click({ timeout: 100, position: { x: 2, y: 3 }, button: 'right' })
    assert.deepEqual(calls, ['move', 'click'])
    let clicks = 0
    const expired = await actionLocator({ elementHandle: async () => ({
      hover: async () => { now += 100 }, click: async () => { clicks++ }, dispose: async () => {},
    }) } as unknown as Locator)
    await assert.rejects(expired.click({ timeout: 100 }), /timed out while moving/)
    assert.equal(clicks, 0)
  } finally { Date.now = originalNow }
})

test('Cloak patches frame-selected handles and rejects a detached target before mouse input', async () => {
  const moduleUrl = new URL('./elementhandle.js', import.meta.resolve('cloakbrowser/human'))
  const { patchFrameElementHandles } = await import(moduleUrl.href)
  let disposed = false
  const forbidden = async () => { throw new Error('Must not issue input for a detached target') }
  const handle = {
    ...Object.fromEntries(['click', 'dblclick', 'hover', 'type', 'fill', 'selectOption', 'check',
      'uncheck', 'setChecked', 'tap', 'focus', '$', '$$', 'waitForSelector'].map(name => [name, forbidden])),
    _humanPatched: false,
    waitForElementState: async () => { throw new Error('Element is detached') },
    dispose: async () => { disposed = true },
  }
  const frame = { waitForSelector: async () => handle }
  patchFrameElementHandles(frame, {}, resolveConfig(), { x: 0, y: 0, initialized: true },
    { move: forbidden, down: forbidden, up: forbidden }, {}, {}, undefined)
  const target = { elementHandle: async () => frame.waitForSelector() } as unknown as Locator
  const action = await actionLocator(target)
  assert.equal(handle._humanPatched, true)
  await assert.rejects(action.click({ timeout: 5 }), ElementNotVisibleError)
  assert.equal(disposed, true)
})

test('selection timeout prevents any cursor input and still cleans up the handle', async () => {
  const originalNow = Date.now
  let now = 1000, inputs = 0, disposed = false
  Date.now = () => now
  try {
    await assert.rejects(clickAction({ elementHandle: async () => {
      now += 100
      return { hover: async () => { inputs++ }, click: async () => { inputs++ },
        dispose: async () => { disposed = true } }
    } } as unknown as Locator, 100), /timed out while selecting/)
    assert.equal(inputs, 0)
    assert.equal(disposed, true)
  } finally { Date.now = originalNow }
})

test('explicit zero timeout allows cursor movement and clicking without a deadline', async () => {
  const calls: string[] = []
  await clickAction({ elementHandle: async () => ({
    hover: async (options: { timeout: number }) => { assert.equal(options.timeout, 0); calls.push('move') },
    click: async (options: { timeout: number }) => { assert.equal(options.timeout, 0); calls.push('click') },
    dispose: async () => { calls.push('dispose') },
  }) } as unknown as Locator, 0)
  assert.deepEqual(calls, ['move', 'click', 'dispose'])
})

test('expiry between clock reads never passes an accidental zero timeout to hover', async () => {
  const originalNow = Date.now
  const times = [1000, 1099, 1100]
  let inputs = 0, disposed = false
  Date.now = () => times.shift() ?? 1100
  try {
    await assert.rejects(clickAction({ elementHandle: async () => ({
      hover: async () => { inputs++ }, click: async () => { inputs++ },
      dispose: async () => { disposed = true },
    }) } as unknown as Locator, 100), /timed out while selecting/)
    assert.equal(inputs, 0)
    assert.equal(disposed, true)
  } finally { Date.now = originalNow }
})

test('a session timeout recalculated after selection does not count selection twice', async () => {
  const originalNow = Date.now
  let now = 1000, disposed = false
  Date.now = () => now
  try {
    const action = await actionLocator({ elementHandle: async () => {
      now += 40
      return {
        hover: async (options: { timeout: number }) => { assert.equal(options.timeout, 60); now += 40 },
        click: async (options: { timeout: number }) => { assert.equal(options.timeout, 20) },
        dispose: async () => { disposed = true },
      }
    } } as unknown as Locator, 100)
    await action.click({ timeout: 1100 - now })
    assert.equal(disposed, true)
  } finally { Date.now = originalNow }
})

test('Cloak emits mouse movement onto the pinned button before mouse-down', async () => {
  const moduleUrl = new URL('./elementhandle.js', import.meta.resolve('cloakbrowser/human'))
  const { patchFrameElementHandles } = await import(moduleUrl.href)
  const calls: string[] = []
  const forbidden = async () => { throw new Error('Must use the humanized mouse path') }
  const handle = {
    ...Object.fromEntries(['click', 'dblclick', 'hover', 'type', 'fill', 'selectOption', 'check',
      'uncheck', 'setChecked', 'tap', 'focus', '$', '$$', 'waitForSelector'].map(name => [name, forbidden])),
    boundingBox: async () => ({ x: 100, y: 100, width: 40, height: 40 }),
    evaluate: async () => false, dispose: async () => { calls.push('dispose') },
  }
  const frame = { waitForSelector: async () => handle }
  const cursor = { x: 10, y: 10, initialized: true }
  const config = resolveConfig('default', { mouse_min_steps: 2, mouse_max_steps: 2,
    mouse_overshoot_chance: 0, mouse_burst_pause: [0, 0], idle_between_actions: false,
    click_aim_delay_button: [0, 0], click_hold_button: [0, 0] })
  patchFrameElementHandles(frame, {}, config, cursor, {
    move: async () => { calls.push('move') },
    down: async () => {
      assert.ok(cursor.x >= 100 && cursor.x <= 140 && cursor.y >= 100 && cursor.y <= 140)
      calls.push('down')
    }, up: async () => { calls.push('up') },
  }, {}, {}, undefined)
  const action = await actionLocator({ elementHandle: async () => frame.waitForSelector() } as unknown as Locator)
  await action.click({ force: true, timeout: 1000 })
  assert.ok(calls.indexOf('down') > calls.indexOf('move'))
  assert.deepEqual(calls.slice(-3), ['down', 'up', 'dispose'])
})
