import {
  createContext,
  useContext,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { apiFetch } from '@/lib/api'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useIsMobile } from '@/hooks/use-mobile'
import { useDocumentVisibility } from '@/hooks/use-document-visibility'
import { applyDisplayEvent, normalizeSessions, type DisplaySession } from '../utils/liveSessions'
import { useErrorHandler } from '@/hooks/useErrorHandler'
import { createSessionSnapshotGuard, isSessionEvent } from '../utils/sessionSnapshot'

function useVncSessionSource(enabled: boolean) {
  const isMobile = useIsMobile()
  const isVisible = useDocumentVisibility()
  const active = enabled && isVisible
  const { handleError } = useErrorHandler()
  const [sessions, setSessions] = useState<DisplaySession[]>([])
  const [previousEnabled, setPreviousEnabled] = useState(enabled)
  if (previousEnabled !== enabled) {
    setPreviousEnabled(enabled)
    setSessions([])
  }
  const [loading, setLoading] = useState(false)
  const [snapshots] = useState(createSessionSnapshotGuard)
  const requestRef = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    const snapshot = snapshots.begin()
    setLoading(true)
    try {
      const data = await apiFetch<DisplaySession[]>('/api/displays', { signal: controller.signal })
      if (!controller.signal.aborted && snapshots.isCurrent(snapshot))
        setSessions(normalizeSessions(data))
    } catch (cause) {
      if (!controller.signal.aborted) handleError(cause, 'VNC sessions')
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null
        setLoading(false)
      }
    }
  }, [handleError, snapshots])

  const handleSocketEvent = useCallback(
    (event: unknown) => {
      if (!isSessionEvent(event)) return
      snapshots.invalidate()
      setSessions((current) => applyDisplayEvent(current, event))
    },
    [snapshots],
  )

  const { connected } = useWebSocket({
    topic: 'displays',
    onEvent: handleSocketEvent,
    enabled: active,
    eventsOnly: true,
    pauseWhenHidden: true,
  })

  useEffect(() => {
    if (!active) {
      return
    }

    let disposed = false
    // Auto-refresh: fast poll while disconnected, slow re-sync while
    // connected so a missed socket event still heals without any button.
    const poll = async () => {
      await refresh()
      if (!disposed) {
        const nextMs = connected ? (isMobile ? 30000 : 15000) : isMobile ? 15000 : 5000
        timer = setTimeout(() => {
          void poll()
        }, nextMs)
      }
    }
    let timer = setTimeout(() => {
      void poll()
    }, 0)
    return () => {
      disposed = true
      snapshots.invalidate()
      requestRef.current?.abort()
      clearTimeout(timer)
    }
  }, [connected, isMobile, active, refresh, snapshots])

  return {
    sessions,
    loading,
    connected,
    refresh,
  }
}

const SessionsContext = createContext<ReturnType<typeof useVncSessionSource> | null>(null)

export function VncSessionsProvider({
  children,
  enabled = true,
}: {
  children: ReactNode
  enabled?: boolean
}) {
  const sessions = useVncSessionSource(enabled)
  return <SessionsContext.Provider value={sessions}>{children}</SessionsContext.Provider>
}

export function useVncSessions() {
  const sessions = useContext(SessionsContext)
  if (!sessions) throw new Error('VncSessionsProvider is required')
  return sessions
}
