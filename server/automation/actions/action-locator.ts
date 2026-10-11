import type { ElementHandle, Locator } from 'playwright-core'

/** Pin one action to its selected element. Cloak patches Frame.waitForSelector handles. */
export async function actionLocator(target: Locator, timeout = 10_000): Promise<Pick<ElementHandle, 'click' | 'fill' | 'hover'>> {
  const element = await target.elementHandle({ timeout })
  if (!element) throw new Error('Action target is detached or missing')
  const run = async (action: () => Promise<void>) => {
    try { await action() }
    finally { await element.dispose().catch(() => {}) }
  }
  return {
    click: options => run(() => element.click(options)),
    fill: (value, options) => run(() => element.fill(value, options)),
    hover: options => run(() => element.hover(options)),
  }
}
