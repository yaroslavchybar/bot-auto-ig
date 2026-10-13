import type { ElementHandle, Locator } from 'playwright-core'
import { errors } from 'playwright-core'
import type { HumanConfig } from 'cloakbrowser/human'
import { revealForClick } from './scroll.js'
import { BrowseSession, SessionEnded } from './session.js'

/** Pin actions to one element and move Cloak's cursor onto it before clicking. */
export async function actionLocator(target: Locator, timeout = 10_000): Promise<Pick<ElementHandle, 'click' | 'fill' | 'hover'>> {
  const selectionDeadline = timeout > 0 ? Date.now() + timeout : Infinity
  const element = await target.elementHandle({ timeout })
  if (!element) throw new Error('Action target is detached or missing')
  const run = async (action: () => Promise<void>) => {
    try { await action() }
    finally { await element.dispose().catch(() => {}) }
  }
  const prepare = async (deadline: number) => {
    try {
      const frame = await element.ownerFrame()
      if (!frame || !await revealForClick(frame.page(), element, new BrowseSession(deadline)))
        throw new Error('Action target is detached or missing')
    } catch (error) {
      if (error instanceof SessionEnded) throw new errors.TimeoutError('Action timed out while revealing its target')
      throw error
    }
  }
  // Our wheel glides reveal targets. Cloak should only move the cursor, without centering them again.
  const humanOptions: { human_config: Partial<HumanConfig> } = { human_config: { scroll_target_zone: [0, 1] } }
  const deadlineFor = (actionTimeout = timeout) => Math.min(selectionDeadline,
    actionTimeout > 0 ? Date.now() + actionTimeout : Infinity)
  const remainingTimeout = (deadline: number) => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new errors.TimeoutError('Action timed out while revealing its target')
    return Number.isFinite(remaining) ? remaining : 0
  }
  return {
    click: options => run(async () => {
      // A caller may pass its remaining session time after selection. Cap that
      // fresh action budget at the original deadline without subtracting selection twice.
      const deadline = deadlineFor(options?.timeout)
      if (deadline <= Date.now()) throw new errors.TimeoutError('Click timed out while selecting its target')
      await prepare(deadline)
      const hoverTimeout = deadline - Date.now()
      if (hoverTimeout <= 0) throw new errors.TimeoutError('Click timed out while selecting its target')
      await element.hover({ ...humanOptions, timeout: Number.isFinite(hoverTimeout) ? hoverTimeout : 0, position: options?.position,
        force: options?.force, modifiers: options?.modifiers, trial: options?.trial })
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new errors.TimeoutError('Click timed out while moving to its target')
      await element.click({ ...humanOptions, ...options, timeout: Number.isFinite(deadline) ? remaining : 0 })
    }),
    fill: (value, options) => run(async () => {
      const deadline = deadlineFor(options?.timeout)
      await prepare(deadline)
      await element.fill(value, { ...humanOptions, ...options, timeout: remainingTimeout(deadline) })
    }),
    hover: options => run(async () => {
      const deadline = deadlineFor(options?.timeout)
      await prepare(deadline)
      await element.hover({ ...humanOptions, ...options, timeout: remainingTimeout(deadline) })
    }),
  }
}

/** Include selection and cursor movement in the caller's click timeout. */
export async function clickAction(target: Locator, timeout = 10_000): Promise<void> {
  await (await actionLocator(target, timeout)).click({ timeout })
}
