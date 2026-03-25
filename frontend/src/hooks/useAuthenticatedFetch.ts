import { useAuth } from '@clerk/react-router'
import { useCallback, useEffect } from 'react'
import { setTokenGetter, apiFetch, type RetryOptions } from '@/lib/api'

function normalizeRequestBody(body: RequestInit['body'] | unknown) {
  if (typeof body !== 'string') {
    return body
  }

  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}

/**
 * Registers the Clerk token getter so that apiFetch / apiFetchWithRetry
 * can attach Authorization headers automatically.
 *
 * Also returns a convenience `authFetch` that delegates to `apiFetch`
 * while preserving the shared retry policy and auth headers.
 */
export function useAuthenticatedFetch() {
  const { getToken } = useAuth()

  useEffect(() => {
    setTokenGetter(getToken)
    return () => {
      setTokenGetter(() => Promise.resolve(null))
    }
  }, [getToken])

  const authFetch = useCallback(
    async <T>(
      endpoint: string,
      options: Omit<RequestInit, 'body'> & {
        body?: unknown
        maxRetries?: number
        onRetry?: RetryOptions['onRetry']
      } = {},
    ): Promise<T> => {
      const { maxRetries, onRetry, method, body, ...rest } = options

      return apiFetch<T>(endpoint, {
        method: method ?? 'GET',
        body: normalizeRequestBody(body),
        maxRetries,
        onRetry,
        ...('timeout' in rest ? { timeout: rest.timeout as number } : {}),
      })
    },
    [],
  )

  return authFetch
}
