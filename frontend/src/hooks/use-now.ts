import { useState, useSyncExternalStore } from 'react'

function createClock(interval: number) {
  let now = Date.now()
  let timer: ReturnType<typeof setInterval> | undefined
  const listeners = new Set<() => void>()
  const tick = () => {
    now = Date.now()
    listeners.forEach((listener) => listener())
  }
  const resume = () => {
    clearInterval(timer)
    timer = undefined
    if (!document.hidden && listeners.size > 0) {
      tick()
      timer = setInterval(tick, interval)
    }
  }
  return {
    getSnapshot: () => now,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      if (listeners.size === 1) {
        document.addEventListener('visibilitychange', resume)
        resume()
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          clearInterval(timer)
          timer = undefined
          document.removeEventListener('visibilitychange', resume)
        }
      }
    },
  }
}

const clocks = new Map<number, ReturnType<typeof createClock>>()
const inactiveSubscribe = () => () => {}

// Consumers with the same interval share one timer, suspended in hidden tabs.
export function useNow(interval = 30_000, enabledUntil = Infinity): number {
  const [startedAt] = useState(Date.now)
  let clock = clocks.get(interval)
  if (!clock) {
    clock = createClock(interval)
    clocks.set(interval, clock)
  }
  const enabled = enabledUntil > Math.max(startedAt, clock.getSnapshot())
  const now = useSyncExternalStore(
    enabled ? clock.subscribe : inactiveSubscribe,
    clock.getSnapshot,
    () => startedAt,
  )
  return Math.max(startedAt, now)
}
