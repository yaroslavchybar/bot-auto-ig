/** Browsing policy shared by the editor, validation, and browser sessions. */
export const browsingNumbers = {
  warmup_min_minutes: { default: 10, min: 1, max: 100 },
  warmup_max_minutes: { default: 20, min: 1, max: 100 },
  session_min_minutes: { default: 5, min: 1, max: 60 },
  session_max_minutes: { default: 10, min: 1, max: 60 },
  rest_min_minutes: { default: 60, min: 1, max: 1440 },
  rest_max_minutes: { default: 120, min: 1, max: 1440 },
}
export type BrowsingNumberKey = keyof typeof browsingNumbers
export const browsingFlags = { browse_home_feed: true, scroll_reels: true, watch_stories: true }
export type BrowsingFlagKey = keyof typeof browsingFlags
export const browsingDefaults = Object.fromEntries(
  Object.entries(browsingNumbers).map(([key, rule]) => [key, rule.default]),
) as Record<BrowsingNumberKey, number>

export function isBrowsingSetting(key: string) {
  return Object.hasOwn(browsingNumbers, key) || Object.hasOwn(browsingFlags, key)
}

export function validateBrowsingRanges(input: Record<string, unknown>) {
  for (const [name, minKey, maxKey] of [
    ['Daily browsing budget', 'warmup_min_minutes', 'warmup_max_minutes'],
    ['Sessions', 'session_min_minutes', 'session_max_minutes'],
    ['Rest between sessions', 'rest_min_minutes', 'rest_max_minutes'],
  ] as const) {
    const min = Number(input[minKey] ?? browsingDefaults[minKey])
    const max = Number(input[maxKey] ?? browsingDefaults[maxKey])
    const rule = browsingNumbers[maxKey]
    if (
      !Number.isFinite(min) ||
      !Number.isFinite(max) ||
      min < rule.min ||
      max < min ||
      max > rule.max
    )
      throw new Error(
        `${name} must be ${rule.min}–${rule.max} minutes, with min no greater than max`,
      )
  }
}
