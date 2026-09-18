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
export { closeBrowser } from './close_browser'

import { delay } from './delay'
import { randomBranch } from './random-branch'
import { loop } from './loop'
import { condition } from './condition'
import { closeBrowser } from './close_browser'

export const controlActivities = [
  delay,
  randomBranch,
  loop,
  condition,
  closeBrowser,
]


