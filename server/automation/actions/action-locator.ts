import type { ElementHandle, Locator, Page } from 'playwright-core'
import { errors } from 'playwright-core'
import type { HumanConfig } from 'cloakbrowser/human'
import { BrowseSession } from './session.js'

/** Pin the element and share its selection budget; Cloak owns scrolling, movement and input. */
export async function actionLocator(target: Locator, timeout = 10_000): Promise<Pick<ElementHandle, 'click' | 'dblclick' | 'fill' | 'hover' | 'dispose'>> {
  const selectionDeadline = timeout > 0 ? Date.now() + timeout : Infinity
  const element = await target.elementHandle({ timeout })
  if (!element) throw new Error('Action target is detached or missing')
  const run = async (action: () => Promise<void>) => {
    try { await action() }
    finally { await element.dispose().catch(() => {}) }
  }
  // Fully visible targets need no extra centering.
  const humanOptions: { human_config: Partial<HumanConfig> } = { human_config: { scroll_target_zone: [0, 1] } }
  const deadlineFor = (actionTimeout = timeout) => Math.min(selectionDeadline,
    actionTimeout > 0 ? Date.now() + actionTimeout : Infinity)
  const remainingTimeout = (deadline: number) => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new errors.TimeoutError('Action timed out while revealing its target')
    return Number.isFinite(remaining) ? remaining : 0
  }
  const click = (method: 'click' | 'dblclick', options?: Parameters<ElementHandle['click']>[0]) => run(async () => {
    // A caller may pass its remaining session time after selection. Cap that
    // fresh action budget at the original deadline without subtracting selection twice.
    const deadline = deadlineFor(options?.timeout)
    if (deadline <= Date.now()) throw new errors.TimeoutError('Click timed out while selecting its target')
    await element[method]({ ...humanOptions, ...options, timeout: remainingTimeout(deadline) })
  })
  return {
    dispose: () => element.dispose(),
    click: options => click('click', options),
    dblclick: options => click('dblclick', options),
    fill: (value, options) => run(async () => {
      const deadline = deadlineFor(options?.timeout)
      await element.fill(value, { ...humanOptions, ...options, timeout: remainingTimeout(deadline) })
    }),
    hover: options => run(async () => {
      const deadline = deadlineFor(options?.timeout)
      await element.hover({ ...humanOptions, ...options, timeout: remainingTimeout(deadline) })
    }),
  }
}

/** Include selection and cursor movement in the caller's click timeout. */
export async function clickAction(target: Locator, timeout = 10_000): Promise<void> {
  await (await actionLocator(target, timeout)).click({ timeout })
}

/** Cloak 0.6 supports scoped locators directly; pin the selected control without DOM markers. */
export async function clickLiveAction(_page: Page, target: Locator, session: BrowseSession, maxTimeout = 5000): Promise<void> {
  const timeout = session.timeout(maxTimeout)
  const options = { timeout, human_config: { scroll_target_zone: [0, 1], mouse_overshoot_chance: 0 } }
  const action = await actionLocator(target, timeout)
  try {
    session.check()
  } catch (error) {
    await action.dispose().catch(() => {})
    throw error
  }
  await action.click(options)
}
