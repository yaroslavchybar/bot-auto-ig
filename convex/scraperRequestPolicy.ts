export const SCRAPER_REQUEST_LIMIT = 10
export const REQUEST_HOUR = 3_600_000
const DAY = 24 * REQUEST_HOUR
const ACTIVE_HOURS = 16

/** A stable randomized wake time between 06:00 and 10:00 for each session. */
export function sessionWakeMinute(profileId: string): number {
  let hash = 2166136261
  for (const char of profileId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return 360 + ((hash >>> 0) % 241)
}

function localClock(timestamp: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(timestamp)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  )
}

function utcClock(local: number, timezone: string): number {
  let utc = local
  for (let i = 0; i < 3; i++) utc += local - localClock(utc, timezone)
  return utc
}

/** Local wake times follow DST; requests never trigger work just to fill a quota. */
export function sessionWindow(profileId: string, timezone: string, now: number) {
  const wakeMinute = sessionWakeMinute(profileId)
  const localDay = Math.floor(localClock(now, timezone) / DAY) * DAY
  const start = utcClock(localDay + wakeMinute * 60_000, timezone)
  const previous = utcClock(localDay - DAY + wakeMinute * 60_000, timezone)
  const activeStart = now < start ? previous : start
  const activeEnd = activeStart + ACTIVE_HOURS * REQUEST_HOUR
  const sleeping = now >= activeEnd
  const nextWakeAt = now < start ? start : utcClock(localDay + DAY + wakeMinute * 60_000, timezone)
  return { wakeMinute, sleeping, activeEnd, availableAt: sleeping ? nextWakeAt : now }
}

export function requestsInHour(times: number[], now: number) {
  return times.filter((at) => at > now - REQUEST_HOUR)
}

export function requestCapacityAt(times: number[]) {
  return times.length >= SCRAPER_REQUEST_LIMIT
    ? times[times.length - SCRAPER_REQUEST_LIMIT]! + REQUEST_HOUR
    : 0
}
