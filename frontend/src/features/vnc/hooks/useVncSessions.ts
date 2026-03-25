import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  applyDisplayEvent,
  normalizeSessions,
  type DisplaySession,
} from '../utils/liveSessions'
import { useErrorHandler } from '@/hooks/useErrorHandler'

/**
 * Fetches and live-updates VNC display sessions.
 *
 * @param enabled – controls whether polling and WebSocket subscription
 *   are active. Callers decide when to enable:
 *   - Grid page passes `useRouteActive('/vnc')` so polling pauses when
 *     the keep-alive cache hides the route.
 *   - Session detail page passes `true` so it always fetches.
 */
export function useVncSessions(enabled: boolean) {
  const isMobile = useIsMobile()
  const { handleError } = useErrorHandler()
  const [sessions, setSessions] = useState<DisplaySession[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<DisplaySession[]>('/api/displays')
      setSessions(normalizeSessions(data))
    } catch (cause) {
      handleError(cause, 'VNC sessions')
    } finally {
      setLoading(false)
    }
  }, [handleError])

  const handleSocketEvent = useCallback((event: unknown) => {
    setSessions((current) => applyDisplayEvent(current, event))
  }, [])

  const { connected } = useWebSocket({
    onEvent: handleSocketEvent,
    enabled,
    pauseWhenHidden: true,
  })

  useEffect(() => {
    if (!enabled) {
      return
    }

    void refresh()

    if (connected) {
      return
    }

    const interval = setInterval(
      () => {
        void refresh()
      },
      isMobile ? 15000 : 5000,
    )

    return () => clearInterval(interval)
  }, [connected, isMobile, enabled, refresh])

  return {
    sessions,
    loading,
    connected,
    refresh,
  }
}
