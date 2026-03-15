import { env } from '@/lib/env'
import { addApiBreadcrumb } from '@/lib/sentry'

// Token getter function - set by useAuthenticatedFetch hook
let tokenGetter: (() => Promise<string | null>) | null = null

export function setTokenGetter(getter: () => Promise<string | null>) {
  tokenGetter = getter
}

const DEFAULT_TIMEOUT_MS = 30000

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path
  }

  return new URL(path, `${env.apiUrl}/`).toString()
}

export async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; timeout?: number } = {},
): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(
    () => controller.abort(),
    options.timeout ?? DEFAULT_TIMEOUT_MS,
  )

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  // Add auth token if available
  if (tokenGetter) {
    try {
      const token = await tokenGetter()
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }
    } catch {
      // Continue without token
    }
  }

  const method = options.method ?? 'GET'
  const url = resolveApiUrl(path)
  let resp: Response
  try {
    resp = await fetch(url, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }

  addApiBreadcrumb(method, path, resp.status)

  if (!resp.ok) {
    const text = await resp.text()
    throw new ApiError(text || `HTTP ${resp.status}`, resp.status)
  }

  if (resp.status === 204) return undefined as T
  return (await resp.json()) as T
}

export async function apiDownload(
  path: string,
  fileName: string,
  options: { timeout?: number } = {},
): Promise<void> {
  const controller = new AbortController()
  const timeoutId = setTimeout(
    () => controller.abort(),
    options.timeout ?? DEFAULT_TIMEOUT_MS,
  )

  const headers: Record<string, string> = {
    Accept: '*/*',
  }

  if (tokenGetter) {
    try {
      const token = await tokenGetter()
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }
    } catch {
      // Continue without token
    }
  }

  let resp: Response
  try {
    resp = await fetch(resolveApiUrl(path), {
      method: 'GET',
      headers,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }

  if (!resp.ok) {
    const text = await resp.text()
    throw new ApiError(text || `HTTP ${resp.status}`, resp.status)
  }

  const blob = await resp.blob()
  const blobUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(blobUrl)
}

// Custom error class to preserve HTTP status
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// --- Retry logic ---

/** HTTP status codes that are safe to retry (transient server errors + rate limit). */
const RETRYABLE_STATUSES = [429, 500, 502, 503, 504]
const MAX_RETRY_DELAY_MS = 10000
const BASE_DELAY_MS = 1000

/** Return true when an error represents a transient failure worth retrying. */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return RETRYABLE_STATUSES.includes(error.status)
  }
  // Network-level failures (no HTTP response received)
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true
  }
  return false
}

export type RetryOptions = {
  maxRetries?: number
  /** Called before each retry attempt with the 1-based attempt number and delay. */
  onRetry?: (attempt: number, delayMs: number, error: Error) => void
}

/**
 * Retry wrapper with exponential backoff + jitter for transient failures.
 *
 * Retries on:
 *  - Network errors (TypeError from fetch)
 *  - HTTP 429, 500, 502, 503, 504
 *
 * Does NOT retry:
 *  - Client errors 4xx (except 429)
 *  - Abort errors (user-initiated or timeout cancellation)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3
  let lastError: Error | undefined

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))

      if (!isRetryableError(lastError)) {
        throw lastError
      }

      if (attempt === maxRetries - 1) {
        throw lastError
      }

      const delay = Math.min(
        BASE_DELAY_MS * Math.pow(2, attempt),
        MAX_RETRY_DELAY_MS,
      )
      const jitter = delay * 0.2 * Math.random()
      const totalDelay = delay + jitter

      opts.onRetry?.(attempt + 1, totalDelay, lastError)

      await new Promise((r) => setTimeout(r, totalDelay))
    }
  }

  throw lastError ?? new Error('Max retries exceeded')
}

/**
 * API fetch with automatic retry for transient failures.
 * Use this for critical operations that should survive network blips.
 */
export async function apiFetchWithRetry<T>(
  path: string,
  options: {
    method?: string
    body?: unknown
    timeout?: number
    maxRetries?: number
    onRetry?: RetryOptions['onRetry']
  } = {},
): Promise<T> {
  const { maxRetries, onRetry, ...fetchOptions } = options
  return withRetry(() => apiFetch<T>(path, fetchOptions), {
    maxRetries,
    onRetry,
  })
}
