import { expect, test } from 'vite-plus/test'
import { dailyOutreachQuota, defaultRoutine } from '../../convex/routinePolicy'

test.each([1, 2, 3, 5, 10, 20, 35])('daily variation respects any configured maximum of %s', maximum => {
  const policy = { ...defaultRoutine, outreachEnabled: true, initialDms: maximum, maxDms: maximum }
  const targets = new Set<number>()
  for (let day = 0; day < 60; day++) {
    const date = new Date(Date.UTC(2026, 0, day + 1)).toISOString().slice(0, 10)
    const quota = dailyOutreachQuota(policy, null, date, 'profile-a')
    expect(quota.allowance).toBeGreaterThanOrEqual(Math.max(1, maximum - 3))
    expect(quota.allowance).toBeLessThanOrEqual(maximum)
    expect(dailyOutreachQuota(policy, null, date, 'profile-a')).toEqual(quota)
    targets.add(quota.allowance)
  }
  expect([...targets].sort((a, b) => a - b)).toEqual(
    Array.from({ length: Math.min(4, maximum) }, (_, index) => maximum - index).sort((a, b) => a - b),
  )
})

test('profiles have independent daily selections and the current ramp caps early days', () => {
  const policy = { ...defaultRoutine, outreachEnabled: true, initialDms: 5, maxDms: 20 }
  const early = dailyOutreachQuota(policy, null, '2026-10-20', 'profile-a')
  expect(early.allowance).toBeGreaterThanOrEqual(2)
  expect(early.allowance).toBeLessThanOrEqual(5)
  const mature = { outreachUsedToday: 0, outreachAllowanceToday: 0, outreachIncrease: 100 }
  const targets = new Set(Array.from({ length: 20 }, (_, i) =>
    dailyOutreachQuota(policy, mature, '2026-10-20', `profile-${i}`).allowance))
  expect([...targets].sort((a, b) => a - b)).toEqual([17, 18, 19, 20])
})

test('saved daily limits and usage survive subsequent sessions and cap edits without rerolling', () => {
  const policy = { ...defaultRoutine, outreachEnabled: true, initialDms: 5, maxDms: 20 }
  const state = { outreachQuotaDate: '2026-10-20', outreachAllowanceToday: 18,
    outreachUsedToday: 6, followedToday: 5, outreachIncrease: 100 }
  expect(dailyOutreachQuota(policy, state, '2026-10-20', 'profile-a'))
    .toEqual({ allowance: 18, used: 6, followed: 5 })
  expect(dailyOutreachQuota({ ...policy, maxDms: 30 }, state, '2026-10-20', 'profile-a').allowance).toBe(18)
  expect(dailyOutreachQuota({ ...policy, maxDms: 10 }, state, '2026-10-20', 'profile-a').allowance).toBe(10)
  const next = dailyOutreachQuota(policy, state, '2026-10-21', 'profile-a')
  expect(next).toMatchObject({ used: 0, followed: 0 })
  expect(next.allowance).toBeGreaterThanOrEqual(17)
  expect(next.allowance).toBeLessThanOrEqual(20)
})
