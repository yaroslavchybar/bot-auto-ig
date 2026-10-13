import type { Page } from 'playwright-core'

/** Geometry for action fixtures that start with their control fully in view. */
export const visibleActionGeometry = {
  boundingBox: async () => ({ x: 100, y: 100, width: 40, height: 40 }),
  ownerFrame: async () => ({ page: () => ({ viewportSize: () => ({ width: 1280, height: 800 }) }) as Page }),
  evaluate: async <R>(fn: (node: Element) => R): Promise<R> => fn({
    parentElement: null,
    tagName: 'BUTTON',
    ownerDocument: { defaultView: { innerHeight: 800, innerWidth: 1280 } },
  } as unknown as Element),
}
