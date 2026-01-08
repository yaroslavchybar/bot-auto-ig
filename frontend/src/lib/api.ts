// Token getter function - set by useAuthenticatedFetch hook
let tokenGetter: (() => Promise<string | null>) | null = null

export function setTokenGetter(getter: () => Promise<string | null>) {
  tokenGetter = getter
}

const DEFAULT_TIMEOUT_MS = 30000

export async function apiFetch<T>(path: string, options: { method?: string; body?: unknown; timeout?: number } = {}): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), options.timeout ?? DEFAULT_TIMEOUT_MS)

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

  let resp: Response
  try {
    resp = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }

  if (!resp.ok) {
    const text = await resp.text()
    throw new ApiError(text || `HTTP ${resp.status}`, resp.status)
  }

  if (resp.status === 204) return undefined as T
  return (await resp.json()) as T
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

// Retry configuration
const RETRYABLE_STATUSES = [408, 429, 500, 502, 503, 504]
const MAX_RETRY_DELAY_MS = 10000

/**
 * Retry wrapper with exponential backoff for transient failures.
 * Retries on network errors and specific HTTP status codes.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))

      // Check if error is retryable
      const isNetworkError = lastError.name === 'AbortError' ||
        lastError.message.includes('fetch failed') ||
        lastError.message.includes('network')
      const isRetryableStatus = lastError instanceof ApiError &&
        RETRYABLE_STATUSES.includes(lastError.status)

      if (!isNetworkError && !isRetryableStatus) {
        throw lastError // Not retryable, fail immediately
      }

      if (attempt === maxRetries - 1) {
        throw lastError // Last attempt, give up
      }

      // Exponential backoff: 1s, 2s, 4s...
      const delay = Math.min(1000 * Math.pow(2, attempt), MAX_RETRY_DELAY_MS)
      const jitter = delay * 0.2 * Math.random()
      await new Promise(r => setTimeout(r, delay + jitter))
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
  options: { method?: string; body?: unknown; timeout?: number; maxRetries?: number } = {}
): Promise<T> {
  const { maxRetries = 3, ...fetchOptions } = options
  return withRetry(() => apiFetch<T>(path, fetchOptions), maxRetries)
}