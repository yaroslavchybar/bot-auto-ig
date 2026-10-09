export const HOUR = 3_600_000
export const MONITOR_WINDOW = 10
export const MIN_NEW_IDS = 3

export type TrafficCheck = {
  at: number
  elapsedMs: number
  newIds: number
  likesGained?: number
}

/** Adapt to measured traffic; incomplete/failed checks never imply inactivity. */
export function monitorTraffic(checks: TrafficCheck[], jitter = Math.random()) {
  const recent = checks.slice(-MONITOR_WINDOW)
  const hours = recent.reduce((sum, check) => sum + check.elapsedMs, 0) / HOUR
  const newIds = recent.reduce((sum, check) => sum + check.newIds, 0)
  const known = recent.filter((check) => check.likesGained !== undefined)
  const knownHours = known.reduce((sum, check) => sum + check.elapsedMs, 0) / HOUR
  const likesPerHour =
    knownHours > 0
      ? known.reduce((sum, check) => sum + check.likesGained!, 0) / knownHours
      : undefined
  const averageNewIds = recent.length ? newIds / recent.length : undefined
  const stopped =
    recent.length === MONITOR_WINDOW &&
    averageNewIds! < MIN_NEW_IDS &&
    known.length === MONITOR_WINDOW &&
    likesPerHour! < 1
  const latest = recent.at(-1)
  const latestHours = latest ? latest.elapsedMs / HOUR : 0
  const traffic = Math.max(
    hours > 0 ? newIds / hours : 0,
    likesPerHour ?? 0,
    latestHours > 0 ? Math.max(latest!.newIds, latest!.likesGained ?? 0) / latestHours : 0,
  )
  // Aim for about 10 new observations; bound jitter too, from 15 minutes to 6 hours.
  const delay = !recent.length
    ? HOUR * (1 + jitter)
    : Math.min(
        6 * HOUR,
        Math.max(HOUR / 4, HOUR * (traffic > 0 ? 10 / traffic : 6) * (0.9 + jitter * 0.2)),
      )
  return { stopped, averageNewIds, likesPerHour, delay: Math.round(delay) }
}
