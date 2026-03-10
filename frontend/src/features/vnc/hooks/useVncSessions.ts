import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useDocumentVisibility } from '@/hooks/use-document-visibility'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  applyDisplayEvent,
  normalizeSessions,
  type DisplaySession,
} from '../utils/liveSessions'

export function useVncSessions() {
  const isMobile = useIsMobile()
  const isVisible = useDocumentVisibility()
  const [sessions, setSessions] = useState<DisplaySession[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const data = await apiFetch<DisplaySession[]>('/api/displays')
      setSessions(normalizeSessions(data))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  const handleSocketEvent = useCallback((event: unknown) => {
    setSessions((current) => applyDisplayEvent(current, event))
  }, [])

  const { connected } = useWebSocket({
    onEvent: handleSocketEvent,
    enabled: isVisible,
    pauseWhenHidden: true,
  })

  useEffect(() => {
    if (!isVisible) {
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
  }, [connected, isMobile, isVisible, refresh])

  return {
    sessions,
    loading,
    error,
    connected,
    refresh,
  }
}
