import { useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { toast } from 'sonner'
import * as Sentry from '@sentry/react-router'

/**
 * Extract a user-visible message from any thrown value.
 */
function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'An unexpected error occurred'
}

/**
 * Centralized error handler that:
 * 1. Shows a toast (sonner) with the error message
 * 2. Reports to Sentry with context
 * 3. Clears toast context on navigation
 *
 * Usage:
 *   const { handleError, wrapAsync } = useErrorHandler()
 *
 *   // Manual error reporting
 *   handleError(error)
 *
 *   // Wrap an async callback so errors are caught automatically
 *   const safeSave = wrapAsync(async () => { await api.save(data) })
 */
export function useErrorHandler() {
  const location = useLocation()
  const lastPathRef = useRef(location.pathname)

  // Dismiss all toasts when the route changes
  useEffect(() => {
    if (lastPathRef.current !== location.pathname) {
      toast.dismiss()
      lastPathRef.current = location.pathname
    }
  }, [location.pathname])

  /**
   * Report an error — shows a toast and captures in Sentry.
   * Returns the extracted message string for callers that still
   * need to store it (e.g. for inline form error display).
   */
  const handleError = useCallback(
    (error: unknown, context?: string): string => {
      const message = extractMessage(error)
      toast.error(context ? `${context}: ${message}` : message)
      Sentry.captureException(error instanceof Error ? error : new Error(message), {
        tags: { context: context ?? 'unknown' },
      })
      return message
    },
    [],
  )

  /**
   * Wrap an async function so that any thrown error is automatically
   * handled (toast + Sentry). The original error is re-thrown so
   * callers can still react to it if needed.
   *
   * Supports an optional `onError` callback for side-effects (e.g.
   * resetting loading state) and `context` string for Sentry tagging.
   */
  const wrapAsync = useCallback(
    <Args extends unknown[], R>(
      fn: (...args: Args) => Promise<R>,
      opts?: { context?: string; onError?: (msg: string) => void },
    ) => {
      return async (...args: Args): Promise<R | undefined> => {
        try {
          return await fn(...args)
        } catch (error) {
          const msg = handleError(error, opts?.context)
          opts?.onError?.(msg)
          return undefined
        }
      }
    },
    [handleError],
  )

  return { handleError, wrapAsync }
}
