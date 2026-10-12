import { expect, test } from 'vite-plus/test'
import { HOUR, DEFAULT_MONITOR_DAYS, monitorDelay } from '../../convex/scrapeMonitoring'

test('monitoring lasts one day with randomized one-to-three-hour checks', () => {
  expect(DEFAULT_MONITOR_DAYS).toBe(1)
  expect(monitorDelay(0)).toBe(HOUR)
  expect(monitorDelay(0.5)).toBe(2 * HOUR)
  expect(monitorDelay(1)).toBe(3 * HOUR)
  expect(monitorDelay(-1)).toBe(HOUR)
  expect(monitorDelay(2)).toBe(3 * HOUR)
})
