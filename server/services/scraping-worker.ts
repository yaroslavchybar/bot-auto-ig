import {
  type DbProfileRow,
  type DbScrapingTaskRow,
  profilesClaimScrapeLease,
  profilesIncrementDailyScrapingUsed,
  profilesMarkScrapeFailure,
  profilesMarkScrapeSuccess,
  profilesRefreshScrapeLease,
  profilesReleaseScrapeLease,
  profilesSweepExpiredScrapeLeases,
  scrapingTasksClaimNext,
  scrapingTasksFinalize,
  scrapingTasksGetById,
  scrapingTasksHeartbeat,
  scrapingTasksNoteRunning,
  scrapingTasksRecordFailure,
  scrapingTasksRecordRetry,
  scrapingTasksStoreChunk,
  scrapingTasksSweepExpiredLeases,
} from '../data/convex.js'
import { broadcast } from '../websocket.js'

type ScraperOutcome = 'success' | 'retryable_error' | 'fatal_error' | 'auth_failed' | 'rate_limited'

type ScraperChunkResult = {
  outcome: ScraperOutcome
  users: any[]
  nextCursor: string | null
  hasMore: boolean
  total: number | null
  statusCode: number | null
  errorCode: string | null
  errorMessage: string | null
  diagnostics?: Record<string, unknown>
}

const SCRAPER_URL = process.env.SCRAPER_URL || 'http://scraper:3003'
const WORKER_ID = `server-worker:${process.pid}`
const POLL_INTERVAL_MS = 2_000
const SWEEP_INTERVAL_MS = 60_000
const LEASE_MS = 90_000
const FETCH_TIMEOUT_MS = 45_000
const MIN_PROFILE_HEALTH = 25
const RETRY_BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000] as const

type TaskLogContext = {
  taskId: string
  profileName?: string | null
  targetUsername?: string | null
  errorCode?: string | null
  outcome?: string | null
  attempt?: number | null
  diagnostics?: string | null
}

function cleanString(value: unknown): string {
  return String(value ?? '').trim()
}

function getProfileId(profile: DbProfileRow): string {
  return cleanString(profile.profile_id)
}

function getTaskTargets(task: DbScrapingTaskRow): string[] {
  return Array.isArray(task.targets)
    ? task.targets.map((value) => cleanString(value)).filter(Boolean)
    : []
}

function getCurrentTarget(task: DbScrapingTaskRow): string | null {
  const targets = getTaskTargets(task)
  const index = typeof task.currentTargetIndex === 'number' ? task.currentTargetIndex : 0
  return index >= 0 && index < targets.length ? targets[index] ?? null : null
}

function getRetryDelay(attempt: number): number {
  const index = Math.min(Math.max(0, attempt), RETRY_BACKOFF_MS.length - 1)
  return RETRY_BACKOFF_MS[index] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]
}

function emitTaskLog(
  level: 'info' | 'warn' | 'error' | 'success',
  message: string,
  context: TaskLogContext,
) {
  broadcast({
    type: 'log',
    level,
    source: 'scraping-task',
    message,
    taskId: context.taskId,
    ...(cleanString(context.profileName) ? { profileName: cleanString(context.profileName) } : {}),
    ...(cleanString(context.targetUsername)
      ? { targetUsername: cleanString(context.targetUsername).replace(/^@+/, '') }
      : {}),
    ...(cleanString(context.errorCode) ? { errorCode: cleanString(context.errorCode) } : {}),
    ...(cleanString(context.outcome) ? { outcome: cleanString(context.outcome) } : {}),
    ...(typeof context.attempt === 'number' ? { attempt: context.attempt } : {}),
    ...(cleanString(context.diagnostics) ? { diagnostics: cleanString(context.diagnostics) } : {}),
  })
}

function formatChunkDiagnostics(chunk: Pick<ScraperChunkResult, 'statusCode' | 'errorMessage' | 'diagnostics' | 'total'>): string {
  const parts: string[] = []
  if (typeof chunk.statusCode === 'number') {
    parts.push(`status=${chunk.statusCode}`)
  }
  if (cleanString(chunk.errorMessage)) {
    parts.push(`message=${cleanString(chunk.errorMessage)}`)
  }
  if (typeof chunk.total === 'number') {
    parts.push(`total=${chunk.total}`)
  }
  if (chunk.diagnostics && typeof chunk.diagnostics === 'object') {
    try {
      parts.push(`diagnostics=${JSON.stringify(chunk.diagnostics)}`)
    } catch {
      parts.push('diagnostics=[unserializable]')
    }
  }
  return parts.join(' | ')
}

function broadcastStatus(taskId: string, status: string, extra: Record<string, unknown> = {}) {
  broadcast({
    type: 'scraping_job_status',
    taskId,
    status,
    ts: Date.now(),
    ...extra,
  })
}

function broadcastProgress(taskId: string, extra: Record<string, unknown>) {
  broadcast({
    type: 'scraping_job_progress',
    taskId,
    ts: Date.now(),
    ...extra,
  })
}

function broadcastError(taskId: string, extra: Record<string, unknown>) {
  broadcast({
    type: 'scraping_job_error',
    taskId,
    ts: Date.now(),
    ...extra,
  })
}

function broadcastProfileLeased(taskId: string, profile: DbProfileRow) {
  broadcast({
    type: 'scraping_profile_leased',
    taskId,
    profileId: getProfileId(profile),
    profileName: cleanString(profile.name),
    ts: Date.now(),
  })
}

async function fetchScraperChunk(task: DbScrapingTaskRow, profile: DbProfileRow, targetUsername: string): Promise<ScraperChunkResult> {
  const endpoint = task.kind === 'following' ? 'following' : 'followers'
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(`${SCRAPER_URL}/scrape/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        auth_username: cleanString(profile.name),
        session_id: cleanString(profile.session_id),
        target_username: targetUsername,
        cursor: cleanString(task.cursor) || null,
        chunk_limit: 200,
        max_pages: 3,
        proxy: cleanString(profile.proxy) || null,
      }),
      signal: controller.signal,
    })

    const text = await response.text()
    let payload: any = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = null
    }

    if (!response.ok) {
      const detail = cleanString(payload?.detail || payload?.error || text || `HTTP ${response.status}`)
      if ([502, 503, 504].includes(response.status)) {
        return {
          outcome: 'retryable_error',
          users: [],
          nextCursor: null,
          hasMore: false,
          total: null,
          statusCode: response.status,
          errorCode: `http_${response.status}`,
          errorMessage: detail || 'Upstream scraper unavailable',
        }
      }
      if (response.status === 401) {
        return {
          outcome: 'auth_failed',
          users: [],
          nextCursor: null,
          hasMore: false,
          total: null,
          statusCode: response.status,
          errorCode: 'auth_failed',
          errorMessage: detail || 'Session verification failed',
        }
      }
      if (response.status === 404) {
        return {
          outcome: 'fatal_error',
          users: [],
          nextCursor: null,
          hasMore: false,
          total: null,
          statusCode: response.status,
          errorCode: 'target_not_found',
          errorMessage: detail || 'Target not found',
        }
      }
      if (response.status === 429) {
        return {
          outcome: 'rate_limited',
          users: [],
          nextCursor: null,
          hasMore: false,
          total: null,
          statusCode: response.status,
          errorCode: 'rate_limited',
          errorMessage: detail || 'Rate limited',
        }
      }
      return {
        outcome: 'fatal_error',
        users: [],
        nextCursor: null,
        hasMore: false,
        total: null,
        statusCode: response.status,
        errorCode: `http_${response.status}`,
        errorMessage: detail || 'Scraper request failed',
      }
    }

    if (payload && typeof payload === 'object' && cleanString(payload.outcome)) {
      const outcome = cleanString(payload.outcome) as ScraperOutcome
      return {
        outcome,
        users: Array.isArray(payload.users) ? payload.users : [],
        nextCursor: cleanString(payload.nextCursor) || null,
        hasMore: Boolean(payload.hasMore),
        total: typeof payload.total === 'number' ? payload.total : null,
        statusCode: response.status,
        errorCode: cleanString(payload.errorCode) || null,
        errorMessage: cleanString(payload.errorMessage) || null,
        diagnostics: payload.diagnostics && typeof payload.diagnostics === 'object' ? payload.diagnostics : undefined,
      }
    }

    return {
      outcome: 'success',
      users: Array.isArray(payload?.users) ? payload.users : [],
      nextCursor: cleanString(payload?.nextCursor) || null,
      hasMore: Boolean(payload?.hasMore) && Boolean(cleanString(payload?.nextCursor)),
      total: typeof payload?.total === 'number' ? payload.total : null,
      statusCode: response.status,
      errorCode: null,
      errorMessage: null,
      diagnostics: payload && typeof payload === 'object' ? { total: payload.total ?? null } : undefined,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      outcome: 'retryable_error',
      users: [],
      nextCursor: null,
      hasMore: false,
      total: null,
      statusCode: null,
      errorCode: 'network_error',
      errorMessage: message,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

async function refreshLeases(taskId: string, profileId: string) {
  const now = Date.now()
  await Promise.all([
    scrapingTasksHeartbeat({ taskId, workerId: WORKER_ID, now, leaseMs: LEASE_MS }),
    profilesRefreshScrapeLease({ profileId, workerId: WORKER_ID, now, leaseMs: LEASE_MS }),
  ])
}

class ScrapingJobWorker {
  private started = false
  private tickTimer: NodeJS.Timeout | null = null
  private sweepTimer: NodeJS.Timeout | null = null
  private busy = false

  start() {
    if (this.started) return
    this.started = true

    this.tickTimer = setInterval(() => {
      void this.tick()
    }, POLL_INTERVAL_MS)
    this.sweepTimer = setInterval(() => {
      void this.sweep()
    }, SWEEP_INTERVAL_MS)

    void this.tick()
    void this.sweep()
  }

  stop() {
    this.started = false
    if (this.tickTimer) clearInterval(this.tickTimer)
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    this.tickTimer = null
    this.sweepTimer = null
  }

  private async tick() {
    if (!this.started || this.busy) return
    this.busy = true
    try {
      const task = await scrapingTasksClaimNext({
        workerId: WORKER_ID,
        now: Date.now(),
        leaseMs: LEASE_MS,
      })
      if (!task?._id) return
      emitTaskLog('info', `Claimed scraping task "${task.name}" for execution`, {
        taskId: task._id,
        attempt: typeof task.attempt === 'number' ? task.attempt : 0,
      })
      await this.runTask(task._id)
    } catch (error) {
      console.error('[ScrapingWorker] Tick failed:', error)
    } finally {
      this.busy = false
    }
  }

  private async sweep() {
    try {
      const [taskSweep, profileSweep] = await Promise.all([
        scrapingTasksSweepExpiredLeases(Date.now()),
        profilesSweepExpiredScrapeLeases(Date.now()),
      ])
      if ((taskSweep?.reclaimed ?? 0) > 0 || (profileSweep?.released ?? 0) > 0) {
        emitTaskLog(
          'warn',
          `Recovered stale scraping leases (tasks=${taskSweep?.reclaimed ?? 0}, profiles=${profileSweep?.released ?? 0})`,
          { taskId: 'system' },
        )
      }
    } catch (error) {
      console.error('[ScrapingWorker] Sweep failed:', error)
    }
  }

  private async runTask(taskId: string) {
    let leasedProfile: DbProfileRow | null = null
    try {
      const claimedTask = await scrapingTasksGetById(taskId)
      if (!claimedTask?._id) return
      emitTaskLog('info', `Starting backend scrape run for "${claimedTask.name}"`, {
        taskId,
        attempt: typeof claimedTask.attempt === 'number' ? claimedTask.attempt : 0,
      })

      leasedProfile = await profilesClaimScrapeLease({
        workerId: WORKER_ID,
        leaseMs: LEASE_MS,
        now: Date.now(),
        minHealth: MIN_PROFILE_HEALTH,
      })

      if (!leasedProfile) {
        const nextTask = await scrapingTasksGetById(taskId)
        const attempt = typeof nextTask?.attempt === 'number' ? nextTask.attempt : 0
        emitTaskLog(
          'warn',
          'No eligible scraping profile is currently available; scheduling retry',
          {
            taskId,
            errorCode: 'no_profile_available',
            attempt,
          },
        )
        await scrapingTasksRecordRetry({
          taskId,
          workerId: WORKER_ID,
          now: Date.now(),
          nextRunAt: Date.now() + getRetryDelay(attempt),
          errorCode: 'no_profile_available',
          errorMessage: 'No eligible scraping profile is currently available',
        })
        broadcastError(taskId, {
          errorCode: 'no_profile_available',
          errorMessage: 'No eligible scraping profile is currently available',
        })
        return
      }

      const profileId = getProfileId(leasedProfile)
      emitTaskLog('info', `Leased profile "${cleanString(leasedProfile.name)}" for scraping`, {
        taskId,
        profileName: cleanString(leasedProfile.name),
      })
      await scrapingTasksNoteRunning({
        taskId,
        workerId: WORKER_ID,
        profileId,
        now: Date.now(),
        leaseMs: LEASE_MS,
      })
      broadcastProfileLeased(taskId, leasedProfile)
      broadcastStatus(taskId, 'running', {
        assignedProfileId: profileId,
        assignedProfileName: cleanString(leasedProfile.name),
      })

      while (true) {
        const task = await scrapingTasksGetById(taskId)
        if (!task?._id) {
          await profilesReleaseScrapeLease({ profileId, workerId: WORKER_ID })
          return
        }

        if (['paused', 'cancelled', 'failed', 'completed'].includes(cleanString(task.status).toLowerCase())) {
          emitTaskLog('info', `Stopping worker loop because task is now "${task.status}"`, {
            taskId,
            profileName: cleanString(leasedProfile.name),
          })
          await profilesReleaseScrapeLease({ profileId, workerId: WORKER_ID })
          return
        }

        const targetUsername = getCurrentTarget(task)
        if (!targetUsername) {
          emitTaskLog('info', 'All targets are complete; building manifest', {
            taskId,
            profileName: cleanString(leasedProfile.name),
          })
          const finalized = await scrapingTasksFinalize({
            taskId,
            workerId: WORKER_ID,
            now: Date.now(),
          })
          await profilesMarkScrapeSuccess({
            profileId,
            workerId: WORKER_ID,
            amount: 0,
            now: Date.now(),
          })
          emitTaskLog('success', 'Scraping task completed and manifest was written', {
            taskId,
            profileName: cleanString(leasedProfile.name),
          })
          broadcastStatus(taskId, 'completed', {
            manifestStorageId: finalized.manifestStorageId,
            stats: finalized.stats,
            chunkCount: finalized.chunkCount,
          })
          return
        }

        await refreshLeases(taskId, profileId)
        emitTaskLog('info', 'Requesting next scrape chunk', {
          taskId,
          profileName: cleanString(leasedProfile.name),
          targetUsername,
          attempt: typeof task.attempt === 'number' ? task.attempt : 0,
        })
        const chunk = await fetchScraperChunk(task, leasedProfile, targetUsername)

        if (chunk.outcome === 'success') {
          if (chunk.users.length > 0) {
            await profilesIncrementDailyScrapingUsed(cleanString(leasedProfile.name), chunk.users.length)
          }

          const stored = await scrapingTasksStoreChunk({
            taskId,
            workerId: WORKER_ID,
            profileId,
            targetUsername,
            users: chunk.users,
            hasMore: chunk.hasMore,
            nextCursor: chunk.nextCursor,
            now: Date.now(),
            leaseMs: LEASE_MS,
          })

          emitTaskLog(
            'success',
            `Stored scrape chunk (${chunk.users.length} users, hasMore=${String(chunk.hasMore)})`,
            {
              taskId,
              profileName: cleanString(leasedProfile.name),
              targetUsername,
              outcome: chunk.outcome,
              diagnostics: formatChunkDiagnostics(chunk),
            },
          )

          broadcastProgress(taskId, {
            targetUsername,
            scraped: chunk.users.length,
            hasMore: chunk.hasMore,
            nextCursor: chunk.nextCursor,
            stats: stored.stats,
            nextTargetUsername: stored.nextTargetUsername,
          })

          if (stored.done) {
            emitTaskLog('info', 'Chunk processing finished all targets; finalizing task', {
              taskId,
              profileName: cleanString(leasedProfile.name),
              targetUsername,
            })
            const finalized = await scrapingTasksFinalize({
              taskId,
              workerId: WORKER_ID,
              now: Date.now(),
            })
            await profilesMarkScrapeSuccess({
              profileId,
              workerId: WORKER_ID,
              amount: 0,
              now: Date.now(),
            })
            emitTaskLog('success', 'Scraping task completed and manifest was written', {
              taskId,
              profileName: cleanString(leasedProfile.name),
              targetUsername,
            })
            broadcastStatus(taskId, 'completed', {
              manifestStorageId: finalized.manifestStorageId,
              stats: finalized.stats,
              chunkCount: finalized.chunkCount,
            })
            return
          }

          await refreshLeases(taskId, profileId)
          continue
        }

        const currentTask = await scrapingTasksGetById(taskId)
        const attempt = typeof currentTask?.attempt === 'number' ? currentTask.attempt : 0

        if (chunk.outcome === 'retryable_error' || chunk.outcome === 'rate_limited') {
          const retryDelay = getRetryDelay(attempt)
          emitTaskLog(
            'warn',
            `Transient scrape failure; scheduling retry in ${Math.round(retryDelay / 1000)}s`,
            {
              taskId,
              profileName: cleanString(leasedProfile.name),
              targetUsername,
              errorCode: chunk.errorCode || chunk.outcome,
              outcome: chunk.outcome,
              attempt,
              diagnostics: formatChunkDiagnostics(chunk),
            },
          )
          await profilesReleaseScrapeLease({ profileId, workerId: WORKER_ID })
          await scrapingTasksRecordRetry({
            taskId,
            workerId: WORKER_ID,
            now: Date.now(),
            nextRunAt: Date.now() + retryDelay,
            errorCode: chunk.errorCode || (chunk.outcome === 'rate_limited' ? 'rate_limited' : 'retryable_error'),
            errorMessage: chunk.errorMessage || 'Transient scraping failure',
          })
          broadcastError(taskId, {
            errorCode: chunk.errorCode || chunk.outcome,
            errorMessage: chunk.errorMessage || 'Transient scraping failure',
            retryAt: Date.now() + getRetryDelay(attempt),
          })
          return
        }

        emitTaskLog('error', 'Fatal scrape failure; task will be marked failed', {
          taskId,
          profileName: cleanString(leasedProfile.name),
          targetUsername,
          errorCode: chunk.errorCode || chunk.outcome,
          outcome: chunk.outcome,
          attempt,
          diagnostics: formatChunkDiagnostics(chunk),
        })
        if (chunk.outcome === 'auth_failed') {
          await profilesMarkScrapeFailure({
            profileId,
            workerId: WORKER_ID,
            now: Date.now(),
          })
        } else {
          await profilesReleaseScrapeLease({ profileId, workerId: WORKER_ID })
        }

        await scrapingTasksRecordFailure({
          taskId,
          workerId: WORKER_ID,
          now: Date.now(),
          errorCode: chunk.errorCode || chunk.outcome,
          errorMessage: chunk.errorMessage || 'Fatal scraping failure',
        })
        broadcastError(taskId, {
          errorCode: chunk.errorCode || chunk.outcome,
          errorMessage: chunk.errorMessage || 'Fatal scraping failure',
        })
        broadcastStatus(taskId, 'failed')
        return
      }
    } catch (error) {
      console.error(`[ScrapingWorker] Task ${taskId} failed:`, error)
      const message = error instanceof Error ? error.message : String(error)
      emitTaskLog('error', `Worker crashed while processing task: ${message}`, {
        taskId,
        profileName: cleanString(leasedProfile?.name),
        errorCode: 'worker_error',
      })
      try {
        await scrapingTasksRecordRetry({
          taskId,
          workerId: WORKER_ID,
          now: Date.now(),
          nextRunAt: Date.now() + getRetryDelay(0),
          errorCode: 'worker_error',
          errorMessage: message,
        })
      } catch (innerError) {
        console.error(`[ScrapingWorker] Failed to record retry for ${taskId}:`, innerError)
      }

      if (leasedProfile) {
        try {
          await profilesReleaseScrapeLease({
            profileId: getProfileId(leasedProfile),
            workerId: WORKER_ID,
          })
        } catch (releaseError) {
          console.error('[ScrapingWorker] Failed to release profile lease:', releaseError)
        }
      }

      broadcastError(taskId, {
        errorCode: 'worker_error',
        errorMessage: message,
      })
    }
  }
}

export const scrapingJobWorker = new ScrapingJobWorker()
