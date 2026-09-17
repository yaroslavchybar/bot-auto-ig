import { sleep } from '../../browser/lifecycle.js'

export { sleep }

export type ActionLogger = (message: string) => void
export type StopCheck = () => boolean

export const random = (min: number, max: number) =>
  min + Math.random() * Math.max(0, max - min)
export const chance = (value: unknown) =>
  Math.random() * 100 < Math.max(0, Math.min(100, Number(value) || 0))
export const numeric = (value: unknown, fallback: number) =>
  value == null || !Number.isFinite(Number(value)) ? fallback : Number(value)

export async function randomDelay(min: number, max: number): Promise<void> {
  await sleep(random(min, max) * 1000)
}
