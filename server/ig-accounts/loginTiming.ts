import { randomInt } from 'node:crypto'

export const minLoginProxyCooldownMs = 3 * 24 * 60 * 60_000
export const maxLoginProxyCooldownMs = 5 * 24 * 60 * 60_000

export function loginProxyCooldownMs(): number {
  return randomInt(minLoginProxyCooldownMs, maxLoginProxyCooldownMs + 1)
}
