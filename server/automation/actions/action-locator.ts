import type { ElementHandle, Locator } from 'playwright-core'
import { errors } from 'playwright-core'

/** Pin actions to one element and move Cloak's cursor onto it before clicking. */
export async function actionLocator(target: Locator, timeout = 10_000): Promise<Pick<ElementHandle, 'click' | 'fill' | 'hover'>> {
  const selectionDeadline = timeout > 0 ? Date.now() + timeout : Infinity
  const element = await target.elementHandle({ timeout })
  if (!element) throw new Error('Action target is detached or missing')
  const run = async (action: () => Promise<void>) => {
    try { await action() }
    finally { await element.dispose().catch(() => {}) }
  }
  return {
    click: options => run(async () => {
      const clickTimeout = options?.timeout ?? timeout
      // A caller may pass its remaining session time after selection. Cap that
      // fresh action budget at the original deadline without subtracting selection twice.
      const deadline = Math.min(selectionDeadline, clickTimeout > 0 ? Date.now() + clickTimeout : Infinity)
      const hoverTimeout = deadline - Date.now()
      if (hoverTimeout <= 0) throw new errors.TimeoutError('Click timed out while selecting its target')
      await element.hover({ timeout: Number.isFinite(hoverTimeout) ? hoverTimeout : 0, position: options?.position,
        force: options?.force, modifiers: options?.modifiers, trial: options?.trial })
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new errors.TimeoutError('Click timed out while moving to its target')
      await element.click({ ...options, timeout: Number.isFinite(deadline) ? remaining : 0 })
    }),
    fill: (value, options) => run(() => element.fill(value, options)),
    hover: options => run(() => element.hover(options)),
  }
}

/** Include selection and cursor movement in the caller's click timeout. */
export async function clickAction(target: Locator, timeout = 10_000): Promise<void> {
  await (await actionLocator(target, timeout)).click({ timeout })
}
