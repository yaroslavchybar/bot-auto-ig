// Shared helper functions for scraping API

import { profilesList, scrapingTasksStoreData, scrapingTasksGetStorageUrl } from '../../data/convex.js'
import { EligibleProfile, ResumeTarget, ResumeState, HttpError } from './types.js'

export { HttpError } from './types.js'

export const SCRAPER_URL = process.env.SCRAPER_URL || 'http://scraper:3003'
export const NO_ELIGIBLE_PROFILES_ERROR = 'No eligible profiles with proxy, sessionId, and remaining daily scraping capacity'
export const CAPACITY_EXHAUSTED_ERROR = 'Daily scraping capacity exhausted before all targets were completed'

// Clean and normalize target usernames from various input formats
export function cleanTargets(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw
      .map((v) => String(v || '').trim().replace(/^@+/, ''))
      .filter(Boolean)
  }
  const text = String(raw || '').trim()
  if (!text) return []
  return text
    .split(/\r?\n/)
    .flatMap((line) => line.split(','))
    .map((v) => String(v || '').trim().replace(/^@+/, ''))
    .filter(Boolean)
}

// Get profiles eligible for scraping (has sessionId, has proxy, within daily limit)
export async function getEligibleProfiles(): Promise<EligibleProfile[]> {
  const all = await profilesList()
  const eligible = (all || [])
    .filter((p: any) => {
      if (!p || typeof p.session_id !== 'string' || !p.session_id.trim()) {
        return false
      }
      // Require proxy for scraping
      const proxy = typeof p.proxy === 'string' ? p.proxy.trim() : ''
      if (!proxy) {
        return false
      }
      const limit = typeof p.daily_scraping_limit === 'number' ? p.daily_scraping_limit : null
      const used = typeof p.daily_scraping_used === 'number' ? p.daily_scraping_used : 0
      if (limit !== null && used >= limit) {
        return false
      }
      return true
    })
    .map((p: any) => ({
      id: String(p.profile_id),
      name: String(p.name),
      sessionId: String(p.session_id || '').trim(),
      proxy: String(p.proxy || '').trim(),
      dailyLimit: typeof p.daily_scraping_limit === 'number' ? p.daily_scraping_limit : null,
      dailyUsed: typeof p.daily_scraping_used === 'number' ? p.daily_scraping_used : 0,
    }))
    .filter((p: any) => p.id && p.name && p.sessionId && p.proxy)
  return eligible
}

export function getRemainingDailyCapacity(profile: EligibleProfile): number | null {
  if (profile.dailyLimit === null) {
    return null
  }
  return Math.max(0, profile.dailyLimit - profile.dailyUsed)
}

export function getChunkLimitForProfile(profile: EligibleProfile, desiredChunkLimit: number): number {
  const remainingCapacity = getRemainingDailyCapacity(profile)
  if (remainingCapacity === null) {
    return Math.max(1, desiredChunkLimit)
  }
  return Math.max(1, Math.min(desiredChunkLimit, remainingCapacity))
}


// Store scraped data in Convex file storage
export async function storeScrapedDataIfNeeded(
  taskId: string | undefined,
  users: any[],
  metadata: Record<string, any>
): Promise<string | undefined> {
  if (!taskId || !Array.isArray(users) || users.length === 0) {
    return undefined
  }
  
  try {
    const { storageId } = await scrapingTasksStoreData(taskId, users, metadata)
    return storageId
  } catch (err) {
    console.error('Failed to store scraped data:', err)
    return undefined
  }
}

// Pick the next eligible profile for auto-only scraping.
export async function pickProfile(
  started: boolean
): Promise<{ profile: EligibleProfile; usedProfile: { id: string; name: string } }> {
  const eligible = await getEligibleProfiles()
  if (eligible.length === 0) {
    throw new HttpError(started ? 429 : 400, started ? CAPACITY_EXHAUSTED_ERROR : NO_ELIGIBLE_PROFILES_ERROR)
  }
  const profile = eligible[0]!
  return {
    profile,
    usedProfile: { id: profile.id, name: profile.name }
  }
}

// Normalize resume state for chunked scraping
export function normalizeResume(
  raw: unknown,
  targets: string[],
  kind: 'followers' | 'following',
  isResume: boolean
): ResumeState {
  const now = Date.now()
  if (!isResume) {
    const perTarget = targets.map((t) => ({ targetUsername: t, cursor: null, scrapedTotal: 0, done: false }))
    return { version: 2, kind, perTarget, done: false, updatedAt: now }
  }

  const base: ResumeState = {
    version: 2,
    kind,
    perTarget: [],
    done: false,
    updatedAt: now,
  }

  if (!raw || typeof raw !== 'object') {
    base.perTarget = targets.map((t) => ({ targetUsername: t, cursor: null, scrapedTotal: 0, done: false }))
    base.done = false
    return base
  }

  const r = raw as Record<string, unknown>
  const per = Array.isArray(r.perTarget) ? (r.perTarget as unknown[]) : []
  const byKey = new Map<string, ResumeTarget>()
  
  for (const item of per) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const tu = String(o.targetUsername || '').trim()
    if (!tu) continue
    const key = tu.toLowerCase()
    const cursorVal = typeof o.cursor === 'string' && o.cursor.trim() ? o.cursor.trim() : null
    const scrapedTotalVal = Number.isFinite(Number(o.scrapedTotal)) ? Math.max(0, Math.floor(Number(o.scrapedTotal))) : 0
    const doneVal = Boolean(o.done)
    byKey.set(key, { targetUsername: tu, cursor: cursorVal, scrapedTotal: scrapedTotalVal, done: doneVal })
  }

  base.perTarget = targets.map((t) => {
    const key = t.toLowerCase()
    const existing = byKey.get(key)
    const scrapedTotalVal = existing ? existing.scrapedTotal : 0
    const cursorVal = existing ? existing.cursor : null
    const doneVal = existing ? existing.done : false
    const doneFinal = doneVal
    return { targetUsername: t, cursor: doneFinal ? null : cursorVal, scrapedTotal: scrapedTotalVal, done: doneFinal }
  })
  base.done = base.perTarget.every((p) => p.done)
  return base
}


// Load existing users from storage for resume operations
export async function loadExistingUsers(storageId: string | undefined, isResume: boolean): Promise<any[]> {
  const sid = typeof storageId === 'string' ? storageId.trim() : ''
  if (!isResume || !sid) return []
  try {
    const url = await scrapingTasksGetStorageUrl(sid)
    if (!url) return []
    const fileResp = await fetch(url)
    if (!fileResp.ok) return []
    const fileJson = await fileResp.json()
    const existing = fileJson && typeof fileJson === 'object' ? (fileJson as any).users : null
    return Array.isArray(existing) ? existing : []
  } catch {
    return []
  }
}

// Deduplicate users by id or username
export function dedupeUsers(arr: any[]): any[] {
  const out: any[] = []
  const seen = new Set<string>()
  for (const u of arr) {
    if (!u || typeof u !== 'object') continue
    const o = u as Record<string, unknown>
    const id = typeof o.id === 'string' || typeof o.id === 'number' ? String(o.id) : ''
    const usernameVal = typeof o.username === 'string' ? o.username : typeof o.userName === 'string' ? o.userName : ''
    const key = (id ? `id:${id}` : usernameVal ? `u:${usernameVal.toLowerCase()}` : `j:${JSON.stringify(o).slice(0, 300)}`)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(u)
  }
  return out
}

// Safely parse limit values with bounds
export function parseLimit(limit: unknown, defaultVal: number, min: number, max: number): number {
  const lim = Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : defaultVal
  return Math.max(min, Math.min(max, lim))
}

export function toSafeLimit(limit: unknown): number {
  return parseLimit(limit, 200, 1, 5000)
}

export function toSafeChunkLimit(limit: unknown): number {
  return parseLimit(limit, 200, 1, 5000)
}

export function toSafeMaxPages(maxPages: unknown): number {
  return parseLimit(maxPages, 10, 1, 100)
}

// Handle error responses consistently
export function handleError(error: unknown, res: any) {
  const status = error && typeof error === 'object' && 'status' in error ? Number((error as any).status) : 500
  const message = error instanceof Error ? error.message : 'Unknown error'
  return res.status(Number.isFinite(status) ? status : 500).json({ error: message })
}
