// Barrel: automation entry points. Implementation lives in ./actions/,
// split by action (feed, stories, profiles, inbox) plus shared
// input primitives (scroll, mouse, navigation, guards).
export { browseFeed } from './actions/feed.js'
export { watchStories } from './actions/stories.js'
export type { ActionLogger, StopCheck } from './actions/shared.js'
