import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright-core'
import { errors } from 'playwright-core'

/** Public Playwright/Cloak surface with strict receivers and no browser or network access. */
export function observationFixture() {
  const makeFailure = () => new errors.TimeoutError('Target could not be found\nCall log:\n - fill("private-message")\n - setInputFiles("private-path")')
  let failure = makeFailure()
  const called: { method: string; args: unknown[] }[] = []
  const locators: object[] = []
  let fail = ''
  let snapshot: unknown = []
  const instrument = (object: Record<string, any>, methods: string[]) => {
    for (const method of methods) object[method] = async function(...args: unknown[]) {
      assert.equal(this, object)
      called.push({ method, args })
      if (method === fail) throw failure
    }
    return object
  }
  const mouse = instrument({}, ['click', 'move', 'wheel', 'down', 'up'])
  const keyboard = instrument({}, ['type', 'press', 'insertText'])
  const makeLocator = (name = 'Follow'): Locator => {
    const locator = instrument({ toString: () => `getByRole('button', {name: '${name}'})`, page: () => page,
      isVisible: async () => false, count: async () => 0,
      ariaSnapshotJSON: async (options: { timeout: number; signal: AbortSignal }) => {
        assert.ok(options.timeout > 0 && options.timeout <= 500)
        assert.ok(options.signal instanceof AbortSignal)
        return snapshot
      },
    }, ['click', 'dblclick', 'fill', 'hover', 'press', 'setChecked', 'selectOption', 'setInputFiles', 'waitFor', 'getAttribute'])
    locator.elementHandle = async () => {
      called.push({ method: 'elementHandle', args: [] })
      if (fail === 'elementHandle') throw failure
      return { evaluate: async (fn: any, arg: unknown) => fn({ isConnected: true, setAttribute() {}, removeAttribute() {} }, arg),
        ownerFrame: async () => frame, dispose: async () => {} }
    }
    for (const method of ['first', 'last', 'nth', 'describe']) locator[method] = function() { assert.equal(this, locator); return locator }
    locator.filter = function(options: { has: object; hasNot?: object }) {
      assert.equal(this, locator)
      assert.ok(locators.includes(options.has), 'nested locators must be unwrapped')
      if (options.hasNot) assert.ok(locators.includes(options.hasNot))
      return locator
    }
    for (const method of ['and', 'or']) locator[method] = function(other: object) { assert.ok(locators.includes(other)); return locator }
    locator.getByRole = (_role: string, options?: { name?: string }) => makeLocator(options?.name)
    locator.locator = (_selector: string, options?: { has?: object }) => {
      if (options?.has) assert.ok(locators.includes(options.has))
      return makeLocator()
    }
    locator.all = async () => [locator]
    locators.push(locator)
    return locator as Locator
  }
  const frame = { locator: () => makeLocator(), getByRole: (_role: string, options?: { name?: string }) => makeLocator(options?.name), page: () => page }
  const frameLocator = { getByRole: () => makeLocator(), owner: () => makeLocator() }
  const page = instrument({ mouse, keyboard, url: () => 'https://www.instagram.com/direct/?token=do-not-log#private',
    locator: () => frame.locator(), getByRole: (role: string, options?: { name?: string }) => frame.getByRole(role, options),
    getByText: (text: string) => frame.getByRole('text', { name: text }),
    frameLocator: () => frameLocator, mainFrame: () => frame, frames: () => [frame], frame: () => frame,
  }, ['goto', 'reload', 'waitForLoadState', 'waitForURL']) as unknown as Page
  return { page, frame, mouse, keyboard, called, get failure() { return failure }, fail: (method: string) => { fail = method; failure = makeFailure() },
    snapshot: (value: unknown) => { snapshot = value } }
}
