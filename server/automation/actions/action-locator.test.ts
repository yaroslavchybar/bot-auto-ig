import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import type { Locator } from 'playwright-core'
import { actionLocator } from './action-locator.js'
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
      assert.deepEqual(events, [method === 'fill' ? 'Hello' : method])
      assert.equal(disposed, 1)

      const nextAction = await actionLocator(target, 3210)
      const replacement = window.document.createElement('button')
      replacement.textContent = 'Replacement'
      selected.replaceWith(replacement)
      await assert.rejects(act(nextAction), /detached/)
      assert.equal(events.length, 1, 'replacement must not receive the action')
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
    click: async () => { throw failure },
    dispose: async () => { throw new Error('Page closed') },
  }) } as unknown as Locator)
  await assert.rejects(action.click(), error => error === failure)
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
