import type { ProfileRecord } from './contracts.js'
/**
 * Convex client for TypeScript using HTTP API.
 */
import '../env.js'
import { randomUUID } from 'node:crypto'
import { currentRequestId } from './logger.js'

const convexCloudUrl = process.env.CONVEX_URL?.trim() || process.env.VITE_CONVEX_URL?.trim()
// Use INTERNAL_API_KEY to call Convex HTTP endpoints (same key as CONVEX_API_KEY in Convex Dashboard)
const convexApiKey = process.env.INTERNAL_API_KEY?.trim() || ''

if (!convexCloudUrl) {
  throw new Error('Convex config missing. Set CONVEX_URL (or VITE_CONVEX_URL) in environment.')
}

if (!convexApiKey) {
  throw new Error('Convex HTTP auth missing. Set INTERNAL_API_KEY in environment.')
}

// HTTP Actions are served at .convex.site, not .convex.cloud
// Convert the URL if needed
const convexUrl = convexCloudUrl.replace('.convex.cloud', '.convex.site')

export type DbProfileRow = ProfileRecord

export type ProfileInput = {
  name: string
  browserSessionId?: string
  proxy?: string
  proxyType?: string
  fingerprintOs?: string
  fingerprintSeed?: number
  cookiesJson?: string
}

// ---------------------------------------------------------------------------
// Retry configuration
// ---------------------------------------------------------------------------

export interface ConvexRetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number
  /** Base delay in milliseconds for exponential backoff (default: 1000) */
  baseDelay: number
}

const DEFAULT_RETRY_CONFIG: ConvexRetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
}

let retryConfig: ConvexRetryConfig = { ...DEFAULT_RETRY_CONFIG }

/**
 * Override default retry configuration.
 * Useful for testing or environment-specific tuning.
 */
export function setRetryConfig(config: Partial<ConvexRetryConfig>): void {
  retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config }
}

/**
 * Known network error codes from Node.js / libuv that indicate a
 * transient connectivity issue worth retrying.
 */
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
])

/**
 * Determine whether a failed request should be retried.
 *
 * Retryable conditions:
 *   - HTTP 429 (Too Many Requests)
 *   - HTTP 5xx (server errors)
 *   - Network / fetch errors (TypeError from fetch, known error codes)
 *
 * Non-retryable:
 *   - HTTP 4xx (client errors) except 429
 *   - JSON parse failures on successful responses
 *   - Any other unknown errors (safe default)
 */
function isRetryable(error: unknown): boolean {
  if (error instanceof ConvexHttpError) {
    const status = error.statusCode
    return status === 429 || status >= 500
  }

  // TypeError is thrown by fetch() on network failures
  if (error instanceof TypeError) {
    return true
  }

  // Node.js errors with a known network error code
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: string }).code
    if (typeof code === 'string' && RETRYABLE_ERROR_CODES.has(code)) {
      return true
    }
  }

  // Unknown errors — do NOT retry (safe default)
  return false
}

/**
 * Compute the delay before the next retry attempt.
 * Formula: baseDelay × 2^attempt + random jitter (0–baseDelay)
 */
function computeBackoff(attempt: number, baseDelay: number): number {
  const exponential = baseDelay * Math.pow(2, attempt)
  const jitter = Math.random() * baseDelay
  return exponential + jitter
}

/**
 * Typed error carrying the HTTP status from Convex.
 */
export class ConvexHttpError extends Error {
  public readonly statusCode: number
  constructor(statusCode: number, body: string) {
    super(`Convex HTTP error ${statusCode}: ${body}`)
    this.name = 'ConvexHttpError'
    this.statusCode = statusCode
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// HTTP client for Convex with exponential backoff retry
async function convexFetch<T>(
  endpoint: string,
  options: { method?: string; body?: any; maxRetries?: number } = {},
): Promise<T> {
  const url = `${convexUrl}${endpoint}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Request-Id': currentRequestId() || randomUUID(),
  }
  headers['Authorization'] = `Bearer ${convexApiKey}`

  const { baseDelay } = retryConfig
  const maxRetries = options.maxRetries ?? retryConfig.maxRetries
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let resp: Response
    try {
      resp = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      })
      if (!resp.ok) {
        const text = await resp.text()
        throw new ConvexHttpError(resp.status, text)
      }
      // Body consumption can fail after headers arrive. SyntaxError is not retryable.
      return await resp.json() as T
    } catch (err) {
      lastError = err

      const canRetry = attempt < maxRetries && isRetryable(err)
      if (!canRetry) {
        throw err
      }

      const delay = computeBackoff(attempt, baseDelay)
      await new Promise((resolve) => setTimeout(resolve, delay))
      continue
    }

  }

  // Unreachable in practice, but satisfies the compiler
  throw lastError
}

export async function profilesList(): Promise<DbProfileRow[]> {
  return convexFetch<DbProfileRow[]>('/api/profiles')
}

export async function profilesSaveUnreadChats(profileId: string, count: number, checkedAt: number): Promise<void> {
  await convexFetch('/api/profiles/unread-chats', {
    method: 'POST', body: { profileId, count, checkedAt }, maxRetries: 0,
  })
}

export async function profilesGetByName(name: string): Promise<DbProfileRow | null> {
  const cleaned = String(name || '').trim()
  if (!cleaned) throw new Error('name is required')
  return convexFetch<DbProfileRow | null>(
    `/api/profiles/by-name?name=${encodeURIComponent(cleaned)}`,
  )
}

export async function profilesUpdateByName(
  oldName: string,
  profile: ProfileInput,
): Promise<DbProfileRow | null> {
  const oldClean = String(oldName || '').trim()
  if (!oldClean) throw new Error('old_name is required')
  const name = String(profile?.name || '').trim()
  if (!name) throw new Error('name is required')
  return convexFetch<DbProfileRow | null>('/api/profiles/update-by-name', {
    method: 'POST',
    maxRetries: 0,
    body: {
      oldName: oldClean,
      browserSessionId: profile.browserSessionId,
      name,
      proxy: profile.proxy,
      proxyType: profile.proxyType,
      fingerprintOs: profile.fingerprintOs,
      fingerprintSeed: profile.fingerprintSeed,
      cookiesJson: profile.cookiesJson,
    },
  })
}

// ==================== AUTOMATIONS ====================

export type DbAutomationRow = {
  modelIds?: string[]
  routine?: { activity: Record<string, number | boolean | string>; headless: boolean; interests?: { label: string; description: string }[];
    ai?: import('./aiSettings.js').AiSettings }
  _id: string
  name: string
  status?: string
  isActive?: boolean
}

export async function automationsGetById(automationId: string): Promise<DbAutomationRow | null> {
  const cleaned = String(automationId || '').trim()
  if (!cleaned) throw new Error('automationId is required')
  return convexFetch<DbAutomationRow | null>(
    `/api/automations/by-id?automationId=${encodeURIComponent(cleaned)}`,
  )
}

export async function automationsReconcileInterrupted(): Promise<{ reconciled: number }> {
  let reconciled = 0
  let cursor: string | undefined
  while (true) {
    const batch = await convexFetch<{ reconciled: number; hasMore?: boolean; cursor?: string }>(
      '/api/automations/reconcile',
      { method: 'POST', body: { cursor } },
    )
    reconciled += batch.reconciled
    if (!batch.hasMore) return { reconciled }
    cursor = batch.cursor
  }
}

// ==================== WARM-UP ====================

export type DbWarmupState = {
  id: string
  profileId: string
  day: number
  date: string
  runsToday: number
  todayMinutes: number
  minutesUsedToday: number
  reservedMinutes: number
  nextRunAt?: number
  lastAutomationId?: string
}

/** Warm-up state for one profile, or null before its first warm-up run. */
export async function warmupGetByProfile(profileId: string): Promise<DbWarmupState | null> {
  const cleaned = String(profileId || '').trim()
  if (!cleaned) throw new Error('profileId is required')
  return convexFetch<DbWarmupState | null>(
    `/api/warmup/by-profile?profileId=${encodeURIComponent(cleaned)}`,
  )
}

export const warmupPrepareDay = (input: { profileId: string; minMinutes: number; maxMinutes: number }) =>
  convexFetch<boolean>('/api/warmup/prepare', { method: 'POST', body: input })

export type WarmupFollowRequest = { profileId: string; runId: string; date: string; username: string }
export const warmupBeginFollow = (input: WarmupFollowRequest) =>
  convexFetch<boolean>('/api/warmup/begin-follow', { method: 'POST', body: input, maxRetries: 0 })
export const warmupConfirmFollow = (input: WarmupFollowRequest) =>
  convexFetch('/api/warmup/confirm-follow', { method: 'POST', body: input })
export const warmupPauseFollows = (profileId: string, date: string, reason: string) =>
  convexFetch('/api/warmup/pause-follows', { method: 'POST', body: { profileId, date, reason } })

export async function warmupBeginRun(input: {
  profileId: string
  automationId: string
  runId: string
  minMinutes: number
  maxMinutes: number
  sessionMinMinutes: number
  sessionMaxMinutes: number
  restMinMinutes: number
  restMaxMinutes: number
}): Promise<{ date: string; minutes: number; remainingMinutes?: number; day?: number; timezone?: string;
  activityPlan?: import('./warmupPlan.js').WarmupActivityCounts; activityUsed?: import('./warmupPlan.js').WarmupActivityCounts }> {
  return convexFetch('/api/warmup/begin', { method: 'POST', body: input })
}

/** Reduced profile payload returned by runtimeListPageInternal (see toRuntimeProfile). */
export type RuntimeProfile = {
  paused?: boolean
  id: string
  name: string
  status?: string
  inUse: boolean
  modelId?: string
  lastOpenedAt?: number
  igLoggedIn?: boolean
  igAccountStatus?: string
  browserLoggedInAt?: number
  outreachReady?: boolean
  pendingRenameFrom?: string
}

export type RuntimePage = {
  automation?: { status?: string; isActive?: boolean; configRevision?: string }
  profiles: RuntimeProfile[]
  warmups?: Array<{ profileId: string; nextRunAt?: number }>
  progress?: Array<{ profileId: string; nextRunAt?: number }>
  nextCursor?: string | null
  isDone?: boolean
} | null

export async function automationsRuntimePage(
  automationId: string,
  modelId: string,
  cursor?: string | null,
): Promise<RuntimePage> {
  const cleaned = String(automationId || '').trim()
  if (!cleaned) throw new Error('automationId is required')
  if (!String(modelId || '').trim()) throw new Error('modelId is required')
  const params = new URLSearchParams({ automationId: cleaned, modelId: String(modelId) })
  if (cursor) params.set('cursor', cursor)
  return convexFetch<RuntimePage>(`/api/automations/runtime-page?${params.toString()}`)
}
export const routineReady = (automationId: string, profileId: string, checkpoint = false) =>
  convexFetch<boolean>('/api/routines/ready', {
    method: 'POST',
    body: { automationId, profileId, checkpoint },
  })
export const routineTarget = (automationId: string, profileId: string) =>
  convexFetch<{ target: number; remaining: number; sent: number }>('/api/routines/target', {
    method: 'POST',
    body: { automationId, profileId },
  })
export const routineNotifications = (automationId: string, profileId: string) =>
  convexFetch<{ date: string; since: number } | null>('/api/routines/notifications', {
    method: 'POST', body: { automationId, profileId },
  })
export const routineOwnLikerPlan = (automationId: string, profileId: string) =>
  convexFetch<{ date: string; ownerIgId: string; runId: string; checkedMediaIds: string[] } | null>('/api/routines/own-likers-plan', {
    method: 'POST', body: { automationId, profileId },
  })
export const routineRecordNotifications = (automationId: string, profileId: string, date: string, events: import('./outreachNotifications.js').OutreachNotification[]) =>
  convexFetch<{ ok: boolean; scanLikers: boolean }>('/api/routines/record-notifications', {
    method: 'POST', body: { automationId, profileId, date, events },
  })
export const routineDmTasks = (automationId: string, profileId: string) =>
  convexFetch<Array<{ leadId: string; username: string; fullName?: string; message: string; date: string; engagement?: 'like' | 'comment' }>>('/api/routines/dm-tasks', { method: 'POST', body: { automationId, profileId } })
export const routineDismissDm = (profileId: string, leadId: string) =>
  convexFetch('/api/routines/dismiss-dm', { method: 'POST', body: { profileId, leadId } })
export const routineBeginFollow = (automationId: string, profileId: string, leadId: string, date: string, attemptId: string,
) =>
  convexFetch<boolean>('/api/routines/begin-follow', { method: 'POST', body: { automationId, profileId, leadId, date, attemptId }, maxRetries: 0,
  })
export const routineCancelFollow = (profileId: string, leadId: string, attemptId: string) =>
  convexFetch('/api/routines/cancel-follow', { method: 'POST', body: { profileId, leadId, attemptId } })
export const routineRecordSession = (
  automationId: string,
  profileId: string,
  activityCompleted: boolean,
  issue?: string,
) =>
  convexFetch('/api/routines/session', {
    method: 'POST',
    body: { automationId, profileId, activityCompleted, issue },
  })
export const routineFinishScreening = (
  automationId: string,
  profileId: string,
  leadId: string,
  screeningToken: string,
  date: string,
  decision?: {
  category: 'male' | 'female' | 'business'
  confidence: number
  model: string
  englishTextCheckPassed?: boolean
},
  failureReason?: 'refused',
) =>
  convexFetch<boolean>('/api/routines/screening', {
    method: 'POST',
    body: { automationId, profileId, leadId, screeningToken, date, ...decision, failureReason },
    maxRetries: 0,
  })
export const routineReserve = (automationId: string, profileId: string) =>
  convexFetch<{ leadId: string; username: string; fullName?: string; isPrivate?: boolean; message: string; date: string
    screeningToken: string
  } | null>(
    '/api/routines/reserve',
    { method: 'POST', body: { automationId, profileId }, maxRetries: 0,
  })
// Never retry authorization to send: a lost response must not cause a duplicate delivery.
export const routineBeginSend = (
  automationId: string,
  profileId: string,
  leadId: string,
  date: string,
) =>
  convexFetch<boolean>('/api/routines/begin-send', {
    method: 'POST',
    body: { automationId, profileId, leadId, date },
    maxRetries: 0,
  })
export const routineFollowTasks = (automationId: string, profileId: string) =>
  convexFetch<Array<{ leadId: string; username: string }>>('/api/routines/follow-tasks', {
    method: 'POST',
    body: { automationId, profileId },
  })
export const routineRecordFollow = (profileId: string, leadId: string, followed: boolean) =>
  convexFetch('/api/routines/record-follow', {
    method: 'POST',
    body: { profileId, leadId, followed },
  })
export const routineFinishSend = (
  profileId: string,
  leadId: string,
  date: string,
  sent: boolean,
  blocked = false,
) =>
  convexFetch('/api/routines/finish-send', {
    method: 'POST',
    body: { profileId, leadId, date, sent, blocked },
  })

export async function warmupFinishRun(input: {
  profileId: string
  runId: string
  date: string
  minutes: number
  activity?: import('./warmupPlan.js').WarmupActivityCounts
}): Promise<void> {
  await convexFetch('/api/warmup/finish', { method: 'POST', body: input })
}
