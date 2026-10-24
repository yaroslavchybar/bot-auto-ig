import { useCallback, useEffect, useRef } from 'react'
import { useLocation } from '@/lib/router'
import { toast } from 'sonner'
import { captureException } from '@/lib/sentry'

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
 *   const { handleError } = useErrorHandler()
 *
 *   // Manual error reporting
 *   handleError(error)
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
  const handleError = useCallback((error: unknown, context?: string): string => {
    const message = extractMessage(error)
    toast.error(context ? `${context}: ${message}` : message)
    captureException(error instanceof Error ? error : new Error(message), {
      tags: { context: context ?? 'unknown' },
    })
    return message
  }, [])

  return { handleError }
}
