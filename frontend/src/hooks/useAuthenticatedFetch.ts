import { useAuth } from '@clerk/react-router'
import { useCallback, useEffect } from 'react'
import { setTokenGetter, apiFetchWithRetry, type RetryOptions } from '@/lib/api'

/**
 * Registers the Clerk token getter so that apiFetch / apiFetchWithRetry
 * can attach Authorization headers automatically.
 *
 * Also returns a convenience `authFetch` that delegates to
 * `apiFetchWithRetry` with automatic retry for transient failures.
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
      options: RequestInit & {
        maxRetries?: number
        onRetry?: RetryOptions['onRetry']
      } = {},
    ): Promise<T> => {
      const { maxRetries, onRetry, method, body, ...rest } = options

      return apiFetchWithRetry<T>(endpoint, {
        method: method ?? 'GET',
        body: body != null ? JSON.parse(body as string) : undefined,
        maxRetries,
        onRetry,
        ...('timeout' in rest ? { timeout: rest.timeout as number } : {}),
      })
    },
    [],
  )

  return authFetch
}
