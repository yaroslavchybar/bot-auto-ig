import { expect, test } from 'vite-plus/test'
import { HOUR, monitorTraffic, type TrafficCheck } from '../../convex/scrapeMonitoring'
const window = (ids: number, likes?: number): TrafficCheck[] =>
  Array.from({ length: 10 }, (_, i) => ({
    at: i * HOUR,
    elapsedMs: HOUR,
    newIds: ids,
    likesGained: likes,
  }))
test('stop requires ten checks and both traffic thresholds', () => {
  expect(monitorTraffic(window(2, 0)).stopped).toBe(true)
  expect(monitorTraffic(window(2, 0).slice(1)).stopped).toBe(false)
  expect(monitorTraffic(window(3, 0)).stopped).toBe(false)
  expect(monitorTraffic(window(2, 1)).stopped).toBe(false)
  expect(monitorTraffic(window(0)).stopped).toBe(false)
})
test('traffic shortens intervals and a fresh surge immediately accelerates checks', () => {
  const quiet = monitorTraffic(window(0, 0), 0.5)
  const busy = monitorTraffic(window(50, 100), 0.5)
  expect(quiet.delay).toBe(6 * HOUR)
  expect(busy.delay).toBe(HOUR / 4)
  const surge = window(0, 0)
  surge[9] = { ...surge[9], newIds: 50, likesGained: 100 }
  expect(monitorTraffic(surge, 0.5).delay).toBe(HOUR / 4)
  expect(monitorTraffic(surge).stopped).toBe(false)
})
test('growth uses elapsed time and only the latest ten checks', () => {
  const checks = window(2, 1).map((c) => ({ ...c, elapsedMs: 2 * HOUR }))
  expect(monitorTraffic(checks).likesPerHour).toBe(0.5)
  expect(monitorTraffic(checks).stopped).toBe(true)
  expect(
    monitorTraffic([{ at: 0, elapsedMs: HOUR, newIds: 100, likesGained: 100 }, ...checks]).stopped,
  ).toBe(true)
  for (const jitter of [0, 1]) {
    expect(monitorTraffic(window(100, 100), jitter).delay).toBeGreaterThanOrEqual(HOUR / 4)
    expect(monitorTraffic(window(0, 0), jitter).delay).toBeLessThanOrEqual(6 * HOUR)
  }
})
