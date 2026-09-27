import { expect, test } from 'vitest'
import { loginProxyCooldownMs, maxLoginProxyCooldownMs, minLoginProxyCooldownMs } from './loginTiming.js'

test('a successful Login proxy cools down for three to five days', () => {
  for (let index = 0; index < 64; index++) {
    const delay = loginProxyCooldownMs()
    expect(delay).toBeGreaterThanOrEqual(minLoginProxyCooldownMs)
    expect(delay).toBeLessThanOrEqual(maxLoginProxyCooldownMs)
  }
})
