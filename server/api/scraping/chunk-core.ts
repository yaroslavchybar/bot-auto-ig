// Core chunked scraping logic shared between followers-chunk and following-chunk

import { profilesIncrementDailyScrapingUsed } from '../../data/convex.js'
import { ResumeState, HttpError } from './types.js'
import {
  SCRAPER_URL,
  cleanTargets,
  parseLimit,
  normalizeResume,
  pickProfile,
  loadExistingUsers,
  dedupeUsers,
  storeScrapedDataIfNeeded,
  handleError,
} from './helpers.js'

export type ChunkKind = 'followers' | 'following'

interface ChunkRequestBody {
  profileId?: string
  targetUsername?: string
  targetUsernames?: string | string[]
  limit?: number
  distribution?: string
  taskId?: string
  resume?: boolean
  resumeState?: unknown
  storageId?: string
  chunkLimit?: number
  maxPages?: number
}

function tryParseJson(text: string): any {
  try {
    return text ? JSON.parse(text) : null
  } catch {
    try {
      return text ? JSON.parse(text.trim()) : null
    } catch {
      return null
    }
  }
}

function isHtmlPayload(text: string): boolean {
  const t = String(text || '').trim().toLowerCase()
  return t.startsWith('<!doctype html') || t.startsWith('<html') || t.includes('<title>504')
}

function sanitizeUpstreamError(status: number, message: string): string {
  const trimmed = String(message || '').trim()
  if (isHtmlPayload(trimmed)) {
    if (status === 504) return 'Upstream timed out (504). Try smaller chunkLimit/maxPages or check proxy/session.'
    if (status === 502) return 'Upstream unavailable (502). Try again or check SCRAPER_URL.'
    if (status === 503) return 'Upstream unavailable (503). Try again or check SCRAPER_URL.'
    return `Upstream error (${status}).`
  }
  return trimmed || `Upstream error (${status}).`
}

async function fetchScrapeChunk(params: {
  endpoint: 'followers' | 'following'
  authUsername: string
  sessionId: string
  targetUsername: string
  limit: number
  chunkLimit: number
  maxPages: number
  cursor: string | null
  proxy: string
}) {
  const resp = await fetch(`${SCRAPER_URL}/scrape/${params.endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      auth_username: params.authUsername,
      session_id: params.sessionId,
      target_username: params.targetUsername,
      limit: params.limit,
      chunk_limit: params.chunkLimit,
      max_pages: params.maxPages,
      cursor: params.cursor,
      proxy: params.proxy,
    }),
  })

  const text = await resp.text()
  const payload = tryParseJson(text)
  return { resp, text, payload }
}

export async function handleChunkRequest(
  kind: ChunkKind,
  body: ChunkRequestBody,
  res: any
) {
  try {
    const {
      profileId,
      targetUsername,
      targetUsernames,
      limit,
      distribution,
      taskId,
      resume,
      resumeState,
      storageId,
      chunkLimit,
      maxPages,
    } = body || {}

    const targets = cleanTargets(targetUsernames ?? targetUsername)
    if (targets.length === 0) {
      return res.status(400).json({ error: 'targetUsername is required' })
    }

    const safeLimit = parseLimit(limit, 200, 1, 5000)
    const safeChunkLimit = parseLimit(chunkLimit, 200, 1, 5000)
    const safeMaxPages = parseLimit(maxPages, 10, 1, 100)

    const dist = String(distribution || '').trim().toLowerCase()
    const isResume = Boolean(resume)
    const cleanedProfileId = String(profileId || '').trim()

    const resumeObj = normalizeResume(resumeState, targets, safeLimit, kind, isResume)
    const next = resumeObj.perTarget.find((t) => !t.done) || null
    
    // All targets done
    if (!next) {
      resumeObj.done = true
      resumeObj.updatedAt = Date.now()
      return res.json({
        kind,
        limit: safeLimit,
        targets,
        done: true,
        resumeState: resumeObj,
        ...(storageId ? { storageId } : {}),
      })
    }

    const remaining = Math.max(0, safeLimit - next.scrapedTotal)
    if (remaining <= 0) {
      next.done = true
      next.cursor = null
      resumeObj.done = resumeObj.perTarget.every((p) => p.done)
      resumeObj.updatedAt = Date.now()
      return res.json({
        kind,
        limit: safeLimit,
        targets,
        done: resumeObj.done,
        resumeState: resumeObj,
        ...(storageId ? { storageId } : {}),
      })
    }

    const effectiveChunk = Math.max(1, Math.min(safeChunkLimit, remaining))
    const { profile, usedProfile } = await pickProfile(dist, cleanedProfileId)

    const endpoint = kind === 'followers' ? 'followers' : 'following'
    let usedChunkLimit = effectiveChunk
    let usedMaxPages = safeMaxPages
    let result = await fetchScrapeChunk({
      endpoint,
      authUsername: profile.name,
      sessionId: profile.sessionId,
      targetUsername: next.targetUsername,
      limit: safeLimit,
      chunkLimit: usedChunkLimit,
      maxPages: usedMaxPages,
      cursor: next.cursor,
      proxy: profile.proxy,
    })

    if (!result.resp.ok) {
      const retryableStatus = [502, 503, 504].includes(result.resp.status)
      const reducedChunkLimit = Math.max(1, Math.min(50, usedChunkLimit))
      const reducedMaxPages = Math.max(1, Math.min(3, usedMaxPages))
      const shouldReduce = reducedChunkLimit !== usedChunkLimit || reducedMaxPages !== usedMaxPages

      if (retryableStatus && shouldReduce) {
        usedChunkLimit = reducedChunkLimit
        usedMaxPages = reducedMaxPages
        result = await fetchScrapeChunk({
          endpoint,
          authUsername: profile.name,
          sessionId: profile.sessionId,
          targetUsername: next.targetUsername,
          limit: safeLimit,
          chunkLimit: usedChunkLimit,
          maxPages: usedMaxPages,
          cursor: next.cursor,
          proxy: profile.proxy,
        })
      }
    }

    if (!result.resp.ok) {
      const message = (result.payload && (result.payload.detail || result.payload.error)) || result.text || `Scraper error (${result.resp.status})`
      let finalMessage = String(message)
      try {
        const nested = JSON.parse(finalMessage)
        if (nested && typeof nested === 'object') {
          finalMessage = String((nested as any).detail || (nested as any).error || finalMessage)
        }
      } catch {
        // ignore
      }
      throw new HttpError(result.resp.status, sanitizeUpstreamError(result.resp.status, finalMessage))
    }

    const users = Array.isArray(result.payload?.users) ? result.payload.users : []
    const scraped = typeof result.payload?.scraped === 'number' ? result.payload.scraped : users.length
    const nextCursor =
      typeof result.payload?.nextCursor === 'string' && result.payload.nextCursor.trim()
        ? result.payload.nextCursor.trim()
        : null
    const hasMore = Boolean(result.payload?.hasMore) && Boolean(nextCursor)

    if (scraped > 0) {
      try {
        await profilesIncrementDailyScrapingUsed(usedProfile.name, scraped)
      } catch (err) {
        console.error(`Failed to increment daily scraping for ${usedProfile.name}:`, err)
      }
    }

    // Update resume state
    next.scrapedTotal = Math.max(0, next.scrapedTotal + Math.max(0, scraped))
    next.cursor = hasMore ? nextCursor : null
    next.done = !hasMore || next.scrapedTotal >= safeLimit
    if (next.done) next.cursor = null

    resumeObj.done = resumeObj.perTarget.every((p) => p.done)
    resumeObj.updatedAt = Date.now()

    // Merge with existing users if resuming
    const existingUsers = await loadExistingUsers(storageId, isResume)
    const mergedUsers = dedupeUsers(isResume ? [...existingUsers, ...users] : users)

    const storedStorageId = await storeScrapedDataIfNeeded(taskId, mergedUsers, {
      kind,
      mode: dist === 'auto' ? 'auto' : 'manual',
      limit: safeLimit,
      chunkLimit: usedChunkLimit,
      maxPages: usedMaxPages,
      targets,
      resumeState: resumeObj,
      lastChunk: {
        targetUsername: next.targetUsername,
        scraped,
        usedProfile,
        hasMore,
      },
      ...(dist === 'auto' ? { distribution: 'auto' } : {}),
    })

    return res.json({
      kind,
      mode: dist === 'auto' ? 'auto' : 'manual',
      ...(dist === 'auto' ? { distribution: 'auto' } : { profileId: cleanedProfileId }),
      limit: safeLimit,
      chunkLimit: usedChunkLimit,
      maxPages: usedMaxPages,
      targets,
      resumed: isResume,
      usedProfile,
      targetUsername: next.targetUsername,
      scraped,
      totalStored: mergedUsers.length,
      done: resumeObj.done,
      resumeState: resumeObj,
      ...(storedStorageId ? { storageId: storedStorageId } : storageId ? { storageId } : {}),
    })
  } catch (error) {
    return handleError(error, res)
  }
}
