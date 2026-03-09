/**
 * Control Flow Activities
 *
 * Activities for controlling workflow execution:
 * - Delays and timing
 * - Branching and conditions
 * - Loops
 */

export { delay } from './delay'
export { randomBranch } from './random-branch'
export { loop } from './loop'
export { condition } from './condition'
export { startBrowser } from './start_browser'
export { closeBrowser } from './close_browser'
export { selectList } from './select_list'

import { delay } from './delay'
import { randomBranch } from './random-branch'
import { loop } from './loop'
import { condition } from './condition'
import { startBrowser } from './start_browser'
import { closeBrowser } from './close_browser'
import { selectList } from './select_list'

export const controlActivities = [
  delay,
  randomBranch,
  loop,
  condition,
  startBrowser,
  closeBrowser,
  selectList,
]


