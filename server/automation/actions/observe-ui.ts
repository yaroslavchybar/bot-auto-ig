import type { Locator, Page } from 'playwright-core'
import { currentUiDiagnosticContext, reportUiFailure } from './ui-diagnostics.js'

const inputs = new Set(['click', 'dblclick', 'tap', 'fill', 'clear', 'press', 'pressSequentially', 'type', 'insertText',
  'check', 'uncheck', 'setChecked', 'selectOption', 'setInputFiles', 'hover', 'dragTo', 'scrollIntoViewIfNeeded', 'focus', 'blur',
  'move', 'wheel', 'down', 'up'])
const waits = new Set(['waitFor', 'waitForSelector', 'waitForURL', 'waitForFunction', 'waitForLoadState',
  'getAttribute', 'inputValue', 'innerText', 'textContent', 'screenshot'])
const navigation = new Set(['goto', 'reload', 'goBack', 'goForward'])
const locatorFactories = new Set(['locator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByTestId',
  'getByAltText', 'getByTitle', 'first', 'last', 'nth', 'filter', 'and', 'or', 'describe', 'owner'])

/** Observe public Playwright calls at the automation boundary, preserving Cloak's receivers and input options.
 * Probes returning false/zero stay quiet; only rejected calls emit a diagnostic. Never record input arguments.
 * Page/frame/input objects keep their identity for desktop input and navigation listeners; restore at lease end.
 */
export function observeAutomationUi(page: Page, stopped: () => boolean): () => void {
  const proxies = new WeakMap<object, object>()
  const originals = new WeakMap<object, object>()
  const observed = new WeakSet<object>()
  const restore: (() => void)[] = []
  let active = true
  type Kind = 'page' | 'locator' | 'frame' | 'frameLocator' | 'mouse' | 'keyboard'
  const unwrap = (value: unknown): unknown => value && typeof value === 'object' ? originals.get(value) || value : value
  const wrap = <T extends object>(object: T, kind: Kind): T => {
    if (!object) return object
    if (originals.has(object)) return object
    const existing = proxies.get(object)
    if (existing) return existing as T
    const methods = new Map<PropertyKey, unknown>()
    const proxy = new Proxy(object, {
      get(target, property) {
        const value = Reflect.get(target, property, target)
        if ((property === 'mouse' || property === 'keyboard') && value) return wrap(value, property)
        if (typeof value !== 'function') return value
        if (methods.has(property)) return methods.get(property)
        const method = String(property)
        const call = (...args: unknown[]) => {
          // Scoped/composed locators must reach Playwright as their original instances.
          const originalArgs = args.map(unwrap)
          if (method === 'filter' || method === 'locator') {
            const index = method === 'filter' ? 0 : 1
            const options = originalArgs[index]
            if (options && typeof options === 'object') {
              const { has, hasNot, ...rest } = options as { has?: Locator; hasNot?: Locator }
              originalArgs[index] = { ...rest, ...(has ? { has: unwrap(has) } : {}), ...(hasNot ? { hasNot: unwrap(hasNot) } : {}) }
            }
          }
          const invoke = () => Reflect.apply(value, target, originalArgs)
          if (!active) return invoke()
          if (locatorFactories.has(method)) return wrap(invoke(), 'locator')
          if (method === 'frameLocator' || method === 'contentFrame') return wrap(invoke(), 'frameLocator')
          if (method === 'page') return wrap(invoke(), 'page')
          if (method === 'mainFrame' || method === 'frame') { const frame = invoke(); return frame ? wrap(frame, 'frame') : frame }
          if (method === 'frames') return invoke().map((frame: object) => wrap(frame, 'frame'))
          if (method === 'all') return invoke().then((locators: Locator[]) => locators.map(locator => wrap(locator, 'locator')))
          const phase = method === 'elementHandle' ? 'selection' : inputs.has(method) ? 'input' : navigation.has(method) ? 'navigation' : 'verification'
          if (!inputs.has(method) && !waits.has(method) && !navigation.has(method) && method !== 'elementHandle') return invoke()
          const startedAt = Date.now()
          const options = args.at(-1)
          const timeout = options && typeof options === 'object' && 'timeout' in options ? options.timeout : undefined
          const context = currentUiDiagnosticContext()
          return (async () => {
            try { return await invoke() }
            catch (error) {
              const diagnosticTarget = kind === 'locator' ? target as unknown as Locator : {
                toString: () => `${kind}.${method}`, page: () => page,
              } as Locator
              await reportUiFailure(diagnosticTarget, error, { stopped, ...context, action: context?.action || `${kind}.${method}`,
                phase, startedAt, timeoutMs: typeof timeout === 'number' ? timeout : undefined })
              throw error
            }
          })()
        }
        methods.set(property, call)
        return call
      },
    })
    proxies.set(object, proxy)
    originals.set(proxy, object)
    if (kind !== 'locator' && kind !== 'frameLocator') {
      if (observed.has(object)) return object
      observed.add(object)
      proxies.set(object, object)
      const methods = new Set([...inputs, ...waits, ...navigation, ...locatorFactories,
        'frameLocator', 'mainFrame', 'frame', 'frames', 'page', 'elementHandle'])
      for (const method of methods) {
        if (typeof Reflect.get(object, method) !== 'function') continue
        const descriptor = Object.getOwnPropertyDescriptor(object, method)
        const wrapped = Reflect.get(proxy, method)
        Object.defineProperty(object, method, { configurable: true, writable: true, enumerable: descriptor?.enumerable ?? false, value: wrapped })
        restore.push(() => {
          if (Reflect.get(object, method) !== wrapped) return
          if (descriptor) Object.defineProperty(object, method, descriptor)
          else Reflect.deleteProperty(object, method)
        })
      }
      if (kind === 'page') {
        wrap((object as unknown as Page).mouse, 'mouse')
        wrap((object as unknown as Page).keyboard, 'keyboard')
      }
      return object
    }
    return proxy
  }
  wrap(page, 'page')
  return () => { active = false; for (const undo of restore.splice(0).reverse()) undo() }
}
