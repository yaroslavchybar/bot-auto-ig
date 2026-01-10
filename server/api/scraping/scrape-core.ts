// Core scraping logic shared between followers and following endpoints

import { profilesGetById, profilesIncrementDailyScrapingUsed } from '../../data/convex.js'
import { HttpError, EligibleProfile } from './types.js'
import { SCRAPER_URL, getEligibleProfiles } from './helpers.js'

export type ScrapeKind = 'followers' | 'following'

interface ScrapeOneParams {
  kind: ScrapeKind
  cleanedTarget: string
  cleanedProfileId: string
  distribution: string
  safeLimit: number
}

function isHtmlPayload(text: string): boolean {
  const t = String(text || '').trim().toLowerCase()
  return t.startsWith('<!doctype html') || t.startsWith('<html') || t.includes('<title>504')
}

function sanitizeUpstreamError(status: number, message: string): string {
  const trimmed = String(message || '').trim()
  if (isHtmlPayload(trimmed)) {
    if (status === 504) return 'Upstream timed out (504). Try smaller limit or check proxy/session.'
    if (status === 502) return 'Upstream unavailable (502). Try again or check SCRAPER_URL.'
    if (status === 503) return 'Upstream unavailable (503). Try again or check SCRAPER_URL.'
    return `Upstream error (${status}).`
  }
  return trimmed || `Upstream error (${status}).`
}

// Scrape a single target with auto-distribution across profiles
async function scrapeWithAutoDistribution(
  kind: ScrapeKind,
  cleanedTarget: string,
  safeLimit: number
) {
  const eligible = await getEligibleProfiles()
  if (eligible.length === 0) {
    throw new HttpError(400, 'No eligible profiles (automation=false, sessionId set, and proxy configured)')
  }

  // Sequential distribution: max out each profile before moving to next
  const tasks: Array<{ profile: EligibleProfile; limit: number }> = []
  let remainingLimit = safeLimit
  
  for (const profile of eligible) {
    if (remainingLimit <= 0) break
    
    let profileLimit = safeLimit
    if (profile.dailyLimit !== null) {
      const remaining = profile.dailyLimit - profile.dailyUsed
      if (remaining <= 0) continue
      profileLimit = Math.min(profileLimit, remaining)
    }
    
    const taskLimit = Math.min(profileLimit, remainingLimit)
    if (taskLimit <= 0) continue
    
    tasks.push({ profile, limit: taskLimit })
    remainingLimit -= taskLimit
  }
  
  const chunkSize = safeLimit
  const endpoint = kind === 'followers' ? 'followers' : 'following'

  const perProfile = await Promise.all(
    tasks.map(async (t) => {
      const resp = await fetch(`${SCRAPER_URL}/scrape/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          auth_username: t.profile.name,
          session_id: t.profile.sessionId,
          target_username: cleanedTarget,
          limit: t.limit,
          proxy: t.profile.proxy,
        }),
      })

      const text = await resp.text()
      let payload: any = null
      try {
        payload = text ? JSON.parse(text) : null
      } catch {
        payload = null
      }

      if (!resp.ok) {
        const message = (payload && (payload.detail || payload.error)) || text || `Scraper error (${resp.status})`
        return {
          ok: false as const,
          status: resp.status,
          usedProfile: { id: t.profile.id, name: t.profile.name },
          scraped: 0,
          error: sanitizeUpstreamError(resp.status, String(message)),
        }
      }

      const users = payload?.users
      const scraped = typeof payload?.scraped === 'number' ? payload.scraped : Array.isArray(users) ? users.length : 0

      if (scraped > 0) {
        try {
          await profilesIncrementDailyScrapingUsed(t.profile.name, scraped)
        } catch (err) {
          console.error(`Failed to increment daily scraping for ${t.profile.name}:`, err)
        }
      }

      return {
        ok: true as const,
        status: resp.status,
        usedProfile: { id: t.profile.id, name: t.profile.name },
        scraped,
        users: Array.isArray(users) ? users : [],
      }
    })
  )

  const users = perProfile.flatMap((r: any) => (r && r.ok && Array.isArray(r.users) ? r.users : []))
  const totalScraped = perProfile.reduce((sum: number, r: any) => sum + (typeof r?.scraped === 'number' ? r.scraped : 0), 0)
  const failures = perProfile.filter((r: any) => !r?.ok)

  return {
    distribution: 'auto',
    targetUsername: cleanedTarget,
    limit: safeLimit,
    eligibleCount: eligible.length,
    chunkSize,
    totalScraped,
    users,
    perProfile: perProfile.map((r: any) => {
      if (r?.ok) {
        return { ok: true, status: r.status, usedProfile: r.usedProfile, scraped: r.scraped }
      }
      return { ok: false, status: r?.status ?? 0, usedProfile: r?.usedProfile, scraped: 0, error: r?.error ?? 'Unknown error' }
    }),
    ...(failures.length > 0 ? { partial: true, failures: failures.length } : {}),
  }
}


// Scrape a single target with a specific profile
async function scrapeWithProfile(
  kind: ScrapeKind,
  cleanedTarget: string,
  cleanedProfileId: string,
  safeLimit: number
) {
  const profile = await profilesGetById(cleanedProfileId)
  if (!profile) {
    throw new HttpError(404, 'Profile not found')
  }
  if (profile.automation === true) {
    throw new HttpError(400, 'Profile automation must be false')
  }
  const sessionId = String(profile.session_id || '').trim()
  if (!sessionId) {
    throw new HttpError(400, 'Profile sessionId is missing')
  }

  // Check proxy is configured
  const proxy = String(profile.proxy || '').trim()
  if (!proxy) {
    throw new HttpError(400, 'Profile proxy is required for scraping')
  }

  // Check daily scraping limit
  const dailyLimit = typeof profile.daily_scraping_limit === 'number' ? profile.daily_scraping_limit : null
  const dailyUsed = typeof profile.daily_scraping_used === 'number' ? profile.daily_scraping_used : 0
  if (dailyLimit !== null && dailyUsed >= dailyLimit) {
    throw new HttpError(429, `Profile ${profile.name} has reached daily scraping limit (${dailyLimit})`)
  }

  // Adjust limit if it would exceed daily limit
  let effectiveLimit = safeLimit
  if (dailyLimit !== null) {
    const remaining = dailyLimit - dailyUsed
    effectiveLimit = Math.min(safeLimit, remaining)
    if (effectiveLimit <= 0) {
      throw new HttpError(429, `Profile ${profile.name} has no remaining daily scraping capacity`)
    }
  }

  const endpoint = kind === 'followers' ? 'followers' : 'following'
  const resp = await fetch(`${SCRAPER_URL}/scrape/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      auth_username: profile.name,
      session_id: sessionId,
      target_username: cleanedTarget,
      limit: effectiveLimit,
      proxy: proxy,
    }),
  })

  const text = await resp.text()
  let payload: any = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }

  if (!resp.ok) {
    const message = (payload && (payload.detail || payload.error)) || text || `Scraper error (${resp.status})`
    throw new HttpError(resp.status, sanitizeUpstreamError(resp.status, String(message)))
  }

  const scraped = typeof payload?.scraped === 'number' ? payload.scraped : Array.isArray(payload?.users) ? payload.users.length : 0
  
  if (scraped > 0) {
    try {
      await profilesIncrementDailyScrapingUsed(profile.name, scraped)
    } catch (err) {
      console.error(`Failed to increment daily scraping for ${profile.name}:`, err)
    }
  }

  return {
    ...(payload ?? {}),
    usedProfile: { id: cleanedProfileId, name: profile.name },
  }
}

// Main scrape function that handles both auto and manual distribution
export async function scrapeOne(params: ScrapeOneParams) {
  const { kind, cleanedTarget, cleanedProfileId, distribution, safeLimit } = params
  
  if (!cleanedTarget) {
    throw new HttpError(400, 'targetUsername is required')
  }

  if (!cleanedProfileId) {
    if (distribution !== 'auto') {
      throw new HttpError(400, 'profileId is required (or use distribution="auto")')
    }
    return scrapeWithAutoDistribution(kind, cleanedTarget, safeLimit)
  }

  return scrapeWithProfile(kind, cleanedTarget, cleanedProfileId, safeLimit)
}
