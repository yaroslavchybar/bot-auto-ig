import { automationsRuntimePage } from '../shared/convexClient.js'
import type { RuntimeWarmup, RuntimeProgress, RuntimeSnapshot } from '../shared/convexRealtime.js'

/** A subscription update wakes earlier; the safety deadline covers missed updates. */
export function routineDueAt(snapshot: RuntimeSnapshot, now = Date.now()): number {
  const fallback = now + 15 * 60_000
  if (!snapshot || snapshot.automation.isActive === false) return fallback
  const today = new Date(now).toISOString().slice(0, 10)
  const midnight = Date.parse(`${today}T00:00:00Z`) + 24 * 60 * 60_000
  const progress = new Map(snapshot.progress?.map(row => [row.profileId, row]))
  const warmups = new Map(snapshot.warmups?.map(row => [row.profileId, row]))
  let earliest = fallback
  for (const profile of snapshot.profiles) {
    if (!profile.igLoggedIn || !accountReady(profile, now)) continue
    if (profile.paused || profile.inUse || profile.status === 'running' || profile.status === 'deleting' || profile.pendingRenameFrom) continue
    const state = progress.get(String(profile.id))
    const warmup = warmups.get(String(profile.id))
    if (state?.paused || state?.issue) continue
    let at = Math.max(now, state?.nextRunAt ?? 0, warmup?.nextRunAt ?? 0)
    if (warmup?.date === today && (warmup.activeRun || (warmup.minutesUsedToday ?? 0) >= (warmup.todayMinutes ?? Infinity)))
      at = Math.max(at, midnight)
    earliest = Math.min(earliest, at)
  }
  return Math.ceil(earliest)
}

/**
 * Sweep every list with keyset cursor pages so profiles outside the first
 * window still enter the queue. Each page performs one bounded index read,
 * so a full sweep costs O(N) reads. Profiles in several lists merge once.
 * Exported for tests.
 */
export async function loadFullRuntimeSnapshot(
  automationId: string,
  modelIds: string[],
  first: RuntimeSnapshot,
  fetchPage = automationsRuntimePage,
): Promise<NonNullable<RuntimeSnapshot>> {
  const base = first ?? { automation: {}, profiles: [] }
  const seen = new Map<string, Record<string, any>>()
  const warmups = new Map<string, RuntimeWarmup>()
  const progress = new Map<string, RuntimeProgress>()
  for (const profile of base.profiles ?? []) seen.set(String(profile.id), profile as Record<string, any>)
  for (const row of base.warmups ?? []) warmups.set(String(row.profileId), row)
  for (const row of base.progress ?? []) progress.set(String(row.profileId), row)
  for (const listId of modelIds.map(String)) {
    let cursor: string | null | undefined = null
    const cursors = new Set<string>()
    let complete = false
    for (let pageNumber = 0; pageNumber < 500; pageNumber++) {
      const page = await fetchPage(automationId, listId, cursor ?? undefined)
      if (!page) throw new Error('Runtime page is unavailable')
      for (const profile of page.profiles ?? []) {
        const id = String(profile.id ?? '')
        if (id) seen.set(id, profile as Record<string, any>)
      }
      for (const row of page.warmups ?? []) {
        const id = String(row.profileId)
        if (id) warmups.set(id, row)
      }
      for (const row of page.progress ?? []) {
        const id = String(row.profileId)
        if (id) progress.set(id, row)
      }
      if (page.isDone) { complete = true; break }
      if (!page.nextCursor || cursors.has(page.nextCursor)) throw new Error('Runtime pagination cursor is missing or repeated')
      cursors.add(page.nextCursor)
      cursor = page.nextCursor
    }
    if (!complete) throw new Error('Runtime pagination exceeded the page limit')
  }
  return {
    automation: base.automation,
    profiles: [...seen.values()],
    warmups: [...warmups.values()],
    progress: [...progress.values()],
    truncated: false,
  }
}


const kyivDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' })
function accountReady(profile: Record<string, any>, now: number): boolean {
  if (profile.igAccountStatus && !['assigned','connected'].includes(profile.igAccountStatus)) return false
  if (profile.browserLoggedInAt) return kyivDate.format(now) !== kyivDate.format(profile.browserLoggedInAt) && now > profile.browserLoggedInAt
  return profile.igAccountStatus === undefined || profile.igAccountStatus === 'connected'
}
