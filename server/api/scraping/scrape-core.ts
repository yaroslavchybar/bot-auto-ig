// Core scraping logic shared between followers and following endpoints.

import { profilesIncrementDailyScrapingUsed } from '../../data/convex.js'
import { HttpError } from './types.js'
import { emitScraperLog, formatScrapeLabel, formatTarget } from './logging.js'
import {
  CAPACITY_EXHAUSTED_ERROR,
  NO_ELIGIBLE_PROFILES_ERROR,
  SCRAPER_URL,
  getChunkLimitForProfile,
  getEligibleProfiles,
} from './helpers.js'

export type ScrapeKind = 'followers' | 'following'

interface ScrapeOneParams {
  kind: ScrapeKind
  cleanedTarget: string
}

const DEFAULT_SCRAPE_CHUNK_LIMIT = 200
const DEFAULT_SCRAPE_MAX_PAGES = 10

function isHtmlPayload(text: string): boolean {
  const t = String(text || '').trim().toLowerCase()
  return t.startsWith('<!doctype html') || t.startsWith('<html') || t.includes('<title>504')
}

function sanitizeUpstreamError(status: number, message: string): string {
  const trimmed = String(message || '').trim()
  if (isHtmlPayload(trimmed)) {
    if (status === 504) return 'Upstream timed out (504). Try a smaller chunk size or check proxy/session.'
    if (status === 502) return 'Upstream unavailable (502). Try again or check SCRAPER_URL.'
    if (status === 503) return 'Upstream unavailable (503). Try again or check SCRAPER_URL.'
    return `Upstream error (${status}).`
  }
  return trimmed || `Upstream error (${status}).`
}

async function scrapeWithAutoDistribution(kind: ScrapeKind, cleanedTarget: string) {
  const scrapeLabel = formatScrapeLabel(kind)
  const targetLabel = formatTarget(cleanedTarget)
  const endpoint = kind === 'followers' ? 'followers' : 'following'
  const users: any[] = []
  const perProfile: Array<{
    ok: boolean
    status: number
    usedProfile: { id: string; name: string }
    scraped: number
    error?: string
  }> = []

  let cursor: string | null = null
  let totalScraped = 0
  let started = false

  emitScraperLog(`Starting ${scrapeLabel} scrape for ${targetLabel}`)

  while (true) {
    const eligible = await getEligibleProfiles()
    if (eligible.length === 0) {
      if (!started) {
        emitScraperLog(`Unable to start ${scrapeLabel} scrape for ${targetLabel}: ${NO_ELIGIBLE_PROFILES_ERROR}`, {
          level: 'warn',
        })
        throw new HttpError(400, NO_ELIGIBLE_PROFILES_ERROR)
      }

      emitScraperLog(`Paused ${scrapeLabel} scrape for ${targetLabel}: ${CAPACITY_EXHAUSTED_ERROR}`, {
        level: 'warn',
      })

      return {
        targetUsername: cleanedTarget,
        totalScraped,
        users,
        perProfile,
        partial: true,
        completed: false,
        capacityExhausted: true,
        error: CAPACITY_EXHAUSTED_ERROR,
      }
    }

    const profile = eligible[0]!
    const chunkLimit = getChunkLimitForProfile(profile, DEFAULT_SCRAPE_CHUNK_LIMIT)

    emitScraperLog(
      `Requesting ${scrapeLabel} chunk for ${targetLabel} using profile ${profile.name} (limit ${chunkLimit}, maxPages ${DEFAULT_SCRAPE_MAX_PAGES}, cursor ${cursor ? 'resume' : 'start'})`,
      { profileName: profile.name }
    )

    const resp = await fetch(`${SCRAPER_URL}/scrape/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        auth_username: profile.name,
        session_id: profile.sessionId,
        target_username: cleanedTarget,
        chunk_limit: chunkLimit,
        max_pages: DEFAULT_SCRAPE_MAX_PAGES,
        cursor,
        proxy: profile.proxy,
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
      const sanitized = sanitizeUpstreamError(resp.status, String(message))
      emitScraperLog(
        `${scrapeLabel} scrape failed for ${targetLabel} using profile ${profile.name}: ${sanitized}`,
        { level: 'error', profileName: profile.name }
      )
      throw new HttpError(resp.status, sanitized)
    }

    const chunkUsers = Array.isArray(payload?.users) ? payload.users : []
    const scraped = typeof payload?.scraped === 'number' ? payload.scraped : chunkUsers.length
    const nextCursor =
      typeof payload?.nextCursor === 'string' && payload.nextCursor.trim()
        ? payload.nextCursor.trim()
        : null
    const hasMore = Boolean(payload?.hasMore) && Boolean(nextCursor)

    started = true
    totalScraped += scraped
    users.push(...chunkUsers)
    perProfile.push({
      ok: true,
      status: resp.status,
      usedProfile: { id: profile.id, name: profile.name },
      scraped,
    })

    emitScraperLog(
      `${hasMore ? 'Fetched' : 'Completed'} ${scraped} ${scrapeLabel} for ${targetLabel} using profile ${profile.name}${hasMore ? '; more pages remain' : `; total ${totalScraped}`}`,
      { level: hasMore ? 'info' : 'success', profileName: profile.name }
    )

    if (scraped > 0) {
      try {
        await profilesIncrementDailyScrapingUsed(profile.name, scraped)
      } catch (err) {
        console.error(`Failed to increment daily scraping for ${profile.name}:`, err)
        emitScraperLog(
          `Failed to update daily scraping usage for profile ${profile.name} after ${scrapeLabel} scrape of ${targetLabel}`,
          { level: 'warn', profileName: profile.name }
        )
      }
    }

    if (!hasMore) {
      return {
        targetUsername: cleanedTarget,
        totalScraped,
        users,
        perProfile,
        completed: true,
      }
    }

    cursor = nextCursor
  }
}

export async function scrapeOne(params: ScrapeOneParams) {
  const { kind, cleanedTarget } = params

  if (!cleanedTarget) {
    throw new HttpError(400, 'targetUsername is required')
  }

  return scrapeWithAutoDistribution(kind, cleanedTarget)
}
