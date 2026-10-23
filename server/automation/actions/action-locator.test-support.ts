import type { Page } from 'playwright-core'

/** Read-only selection handle; input stays on the fixture's locator. */
export async function actionElementHandle(this: { waitFor: (options: { state: string; timeout: number }) => Promise<unknown> }, options: { timeout: number }) {
  await this.waitFor({ state: 'attached', timeout: options.timeout })
  const node = { isConnected: true, setAttribute: () => {}, removeAttribute: () => {} }
  return {
    ownerFrame: async () => ({ locator: () => this }),
    evaluate: async <T, A>(fn: (node: Element, arg: A) => T, arg: A) => fn(node as unknown as Element, arg),
    dispose: async () => {},
  }
}

/** Geometry for action fixtures that start with their control fully in view. */
export const visibleActionGeometry = {
  waitFor: async () => {},
  elementHandle: actionElementHandle,
  boundingBox: async () => ({ x: 100, y: 100, width: 40, height: 40 }),
  ownerFrame: async () => ({ page: () => ({ viewportSize: () => ({ width: 1280, height: 800 }) }) as Page }),
  evaluate: async <R>(fn: (node: Element) => R): Promise<R> => fn({
    parentElement: null,
    tagName: 'BUTTON',
    ownerDocument: { defaultView: { innerHeight: 800, innerWidth: 1280 } },
  } as unknown as Element),
}
