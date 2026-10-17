export const HOUR = 3_600_000
export const DEFAULT_SCRAPE_POST_LIMIT = 10
/** Fixed randomized spacing, independent of likes, new IDs, or traffic. */
export const monitorDelay = (jitter = Math.random()) =>
  Math.round(HOUR * (1 + Math.max(0, Math.min(1, jitter)) * 2))
