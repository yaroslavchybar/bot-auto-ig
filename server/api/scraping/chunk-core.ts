// Core chunked scraping logic shared between followers-chunk and following-chunk.

import { profilesIncrementDailyScrapingUsed } from '../../data/convex.js'
import { HttpError } from './types.js'
import { emitScraperLog, formatScrapeLabel, formatTarget } from './logging.js'
import {
  CAPACITY_EXHAUSTED_ERROR,
  SCRAPER_URL,
  cleanTargets,
  dedupeUsers,
  getChunkLimitForProfile,
  handleError,
  loadExistingUsers,
  normalizeResume,
  parseLimit,
  pickProfile,
  storeScrapedDataIfNeeded,
} from './helpers.js'

export type ChunkKind = 'followers' | 'following'

interface ChunkRequestBody {
  targetUsername?: string
  targetUsernames?: string | string[]
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

function hasResumeProgress(resumeState: ReturnType<typeof normalizeResume>): boolean {
  return resumeState.perTarget.some((target) => target.scrapedTotal > 0 || target.done || Boolean(target.cursor))
}

export async function handleChunkRequest(
  kind: ChunkKind,
  body: ChunkRequestBody,
  res: any
) {
  try {
    const scrapeLabel = formatScrapeLabel(kind)
    const {
      targetUsername,
      targetUsernames,
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

    const safeChunkLimit = parseLimit(chunkLimit, 200, 1, 5000)
    const safeMaxPages = parseLimit(maxPages, 10, 1, 100)
    const isResume = Boolean(resume)

    const resumeObj = normalizeResume(resumeState, targets, kind, isResume)
    const next = resumeObj.perTarget.find((target) => !target.done) || null

    if (!next) {
      resumeObj.done = true
      resumeObj.updatedAt = Date.now()
      emitScraperLog(`No remaining ${scrapeLabel} chunks to process; request is already complete`, {
        level: 'success',
      })
      return res.json({
        kind,
        targets,
        done: true,
        resumeState: resumeObj,
        ...(storageId ? { storageId } : {}),
      })
    }

    let profileSelection: Awaited<ReturnType<typeof pickProfile>>
    try {
      profileSelection = await pickProfile(isResume || hasResumeProgress(resumeObj))
    } catch (error) {
      if (error instanceof HttpError && error.status === 429 && error.message === CAPACITY_EXHAUSTED_ERROR) {
        resumeObj.done = false
        resumeObj.updatedAt = Date.now()
        emitScraperLog(
          `Paused ${scrapeLabel} chunk processing for ${formatTarget(next.targetUsername)}: ${CAPACITY_EXHAUSTED_ERROR}`,
          { level: 'warn' }
        )
        return res.json({
          kind,
          targets,
          resumed: isResume,
          done: false,
          capacityExhausted: true,
          error: CAPACITY_EXHAUSTED_ERROR,
          resumeState: resumeObj,
          ...(storageId ? { storageId } : {}),
        })
      }
      throw error
    }

    const { profile, usedProfile } = profileSelection
    let usedChunkLimit = getChunkLimitForProfile(profile, safeChunkLimit)
    let usedMaxPages = safeMaxPages
    const targetLabel = formatTarget(next.targetUsername)

    emitScraperLog(
      `${isResume ? 'Resuming' : 'Starting'} ${scrapeLabel} chunk for ${targetLabel} using profile ${usedProfile.name} (limit ${usedChunkLimit}, maxPages ${usedMaxPages})`,
      { profileName: usedProfile.name }
    )

    const endpoint = kind === 'followers' ? 'followers' : 'following'
    let result = await fetchScrapeChunk({
      endpoint,
      authUsername: profile.name,
      sessionId: profile.sessionId,
      targetUsername: next.targetUsername,
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
        emitScraperLog(
          `Retrying ${scrapeLabel} chunk for ${targetLabel} using smaller limits (${usedChunkLimit}/${usedMaxPages}) after upstream ${result.resp.status}`,
          { level: 'warn', profileName: usedProfile.name }
        )
        result = await fetchScrapeChunk({
          endpoint,
          authUsername: profile.name,
          sessionId: profile.sessionId,
          targetUsername: next.targetUsername,
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
      const sanitized = sanitizeUpstreamError(result.resp.status, finalMessage)
      emitScraperLog(
        `${scrapeLabel} chunk failed for ${targetLabel} using profile ${usedProfile.name}: ${sanitized}`,
        { level: 'error', profileName: usedProfile.name }
      )
      throw new HttpError(result.resp.status, sanitized)
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
        emitScraperLog(
          `Failed to update daily scraping usage for profile ${usedProfile.name} after ${scrapeLabel} chunk for ${targetLabel}`,
          { level: 'warn', profileName: usedProfile.name }
        )
      }
    }

    next.scrapedTotal = Math.max(0, next.scrapedTotal + Math.max(0, scraped))
    next.cursor = hasMore ? nextCursor : null
    next.done = !hasMore
    if (next.done) next.cursor = null

    resumeObj.done = resumeObj.perTarget.every((target) => target.done)
    resumeObj.updatedAt = Date.now()

    const existingUsers = await loadExistingUsers(storageId, isResume)
    const mergedUsers = dedupeUsers(isResume ? [...existingUsers, ...users] : users)

    const storedStorageId = await storeScrapedDataIfNeeded(taskId, mergedUsers, {
      kind,
      autoOnly: true,
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
    })

    emitScraperLog(
      `${resumeObj.done ? 'Completed' : 'Fetched'} ${scraped} ${scrapeLabel} for ${targetLabel} using profile ${usedProfile.name}${hasMore ? '; resume cursor saved' : `; total stored ${mergedUsers.length}`}`,
      { level: resumeObj.done ? 'success' : 'info', profileName: usedProfile.name }
    )

    return res.json({
      kind,
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
