import { useCallback, useRef, useState } from 'react'
import {
  apiFetchWithRetry,
  isRetryableError,
  type RetryOptions,
} from '@/lib/api'

export type ApiCallState = {
  /** True from the moment the request starts until it resolves or finally fails. */
  isLoading: boolean
  /** True only while a retry delay is in progress (not during the initial attempt). */
  isRetrying: boolean
  /** The current retry attempt number (0 = initial request, 1 = first retry, …). */
  retryAttempt: number
  /** The final error after all retries are exhausted, or null. */
  error: Error | null
}

type ExecuteOptions = {
  method?: string
  body?: unknown
  timeout?: number
  maxRetries?: number
}

/**
 * Hook that wraps `apiFetchWithRetry` and exposes loading / retry state.
 *
 * During retries the hook reports `isRetrying: true` so the UI can show
 * a "retrying…" indicator instead of an immediate error.
 *
 * ```tsx
 * const { state, execute } = useApiCall()
 *
 * async function handleClick() {
 *   const data = await execute<MyData>('/api/something')
 *   if (data) { … }
 * }
 *
 * {state.isRetrying && <span>Retrying (attempt {state.retryAttempt})…</span>}
 * ```
 */
export function useApiCall() {
  const [state, setState] = useState<ApiCallState>({
    isLoading: false,
    isRetrying: false,
    retryAttempt: 0,
    error: null,
  })

  // Keep a generation counter so that stale callbacks don't update state.
  const genRef = useRef(0)

  const execute = useCallback(
    async <T>(
      path: string,
      options: ExecuteOptions = {},
    ): Promise<T | undefined> => {
      const gen = ++genRef.current

      setState({
        isLoading: true,
        isRetrying: false,
        retryAttempt: 0,
        error: null,
      })

      const onRetry: RetryOptions['onRetry'] = (attempt) => {
        if (gen !== genRef.current) return
        setState({
          isLoading: true,
          isRetrying: true,
          retryAttempt: attempt,
          error: null,
        })
      }

      try {
        const { maxRetries, ...fetchOpts } = options
        const result = await apiFetchWithRetry<T>(path, {
          ...fetchOpts,
          maxRetries,
          onRetry,
        })

        if (gen === genRef.current) {
          setState({
            isLoading: false,
            isRetrying: false,
            retryAttempt: 0,
            error: null,
          })
        }
        return result
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e))
        if (gen === genRef.current) {
          setState({
            isLoading: false,
            isRetrying: false,
            retryAttempt: 0,
            error,
          })
        }
        throw error
      }
    },
    [],
  )

  return { state, execute, isRetryableError }
}
