import { useEffect, useRef, useState } from 'react'
import RFB from '@novnc/novnc/lib/rfb.js'
import { cn } from '@/lib/utils'
import { useDocumentVisibility } from '@/hooks/use-document-visibility'
import { buildVncWebSocketUrl } from '../utils/buildVncWebSocketUrl'

interface VncViewerProps {
  url?: string
  className?: string
  interactive?: boolean
}

type DisconnectEvent = Event & {
  detail?: {
    clean?: boolean
  }
}

type SecurityFailureEvent = Event & {
  detail?: {
    reason?: string
    status?: number
  }
}

type OverlayState = {
  tone: 'info' | 'error'
  text: string
} | null

const RECONNECT_DELAY_MS = 1500

const DEFAULT_VNC_URL = buildVncWebSocketUrl(6080)

/* ── Fullscreen keyboard shortcut ── */

function useFullscreenKey(
  interactive: boolean,
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!interactive) return
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT' ||
        (document.activeElement as HTMLElement)?.isContentEditable
      ) {
        return
      }
      if (e.key.toLowerCase() === 'f') {
        if (!document.fullscreenElement) {
          containerRef.current?.requestFullscreen().catch((err) => {
            console.error(`Error attempting to enable fullscreen: ${err.message}`)
          })
        } else {
          document.exitFullscreen()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [interactive, containerRef])
}

/* ── Sync interactive state to RFB ── */

function useSyncInteractive(
  interactive: boolean,
  rfbRef: React.RefObject<RFB | null>,
  interactiveRef: React.MutableRefObject<boolean>,
) {
  useEffect(() => {
    interactiveRef.current = interactive
    const rfb = rfbRef.current
    if (!rfb) return
    rfb.viewOnly = !interactive
    rfb.focusOnClick = interactive
  }, [interactive, rfbRef, interactiveRef])
}

/* ── RFB connection lifecycle ── */

function useRfbConnection(
  enabled: boolean,
  url: string,
  screenRef: React.RefObject<HTMLDivElement | null>,
  rfbRef: React.MutableRefObject<RFB | null>,
  interactiveRef: React.MutableRefObject<boolean>,
) {
  const reconnectTimerRef = useRef<number | null>(null)
  const reconnectAttemptRef = useRef(0)
  const [connectionOverlay, setConnectionOverlay] = useState<OverlayState>({
    tone: 'info',
    text: 'Connecting to display...',
  })
  const [reconnectKey, setReconnectKey] = useState(0)

  useEffect(() => {
    const screen = screenRef.current
    if (!screen || !enabled) return

    const lifecycle = { disposed: false, terminalFailure: false }

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }

    const scheduleReconnect = () => {
      if (lifecycle.disposed || lifecycle.terminalFailure || reconnectTimerRef.current !== null) return
      reconnectAttemptRef.current += 1
      setConnectionOverlay({
        tone: 'info',
        text:
          reconnectAttemptRef.current > 1
            ? `Connection lost. Retrying (${reconnectAttemptRef.current})...`
            : 'Connection lost. Reconnecting...',
      })
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null
        setReconnectKey((current) => current + 1)
      }, Math.min(RECONNECT_DELAY_MS * 2 ** Math.min(reconnectAttemptRef.current - 1, 5), 30000))
    }

    screen.replaceChildren()
    const rfb = new RFB(screen, url)
    rfbRef.current = rfb
    configureRfb(rfb, interactiveRef)
    attachRfbListeners(rfb, lifecycle, clearReconnectTimer,
      reconnectAttemptRef, setConnectionOverlay, scheduleReconnect)

    return () => {
      lifecycle.disposed = true
      clearReconnectTimer()
      detachAndDisconnect(rfb, rfbRef, screen)
    }
  }, [enabled, reconnectKey, url, screenRef, rfbRef, interactiveRef])

  return { connectionOverlay }
}

function configureRfb(rfb: RFB, interactiveRef: React.MutableRefObject<boolean>) {
  const computedStyle = getComputedStyle(document.documentElement)
  rfb.background =
    computedStyle.getPropertyValue('--overlay-strong').trim() ||
    computedStyle.getPropertyValue('--background').trim()
  rfb.scaleViewport = true
  rfb.resizeSession = false
  rfb.focusOnClick = interactiveRef.current
  rfb.viewOnly = !interactiveRef.current
}

function attachRfbListeners(
  rfb: RFB,
  lifecycle: { disposed: boolean; terminalFailure: boolean },
  clearReconnectTimer: () => void,
  reconnectAttemptRef: React.MutableRefObject<number>,
  setConnectionOverlay: (s: OverlayState) => void,
  scheduleReconnect: () => void,
) {
  rfb.addEventListener('connect', () => {
    if (lifecycle.disposed || lifecycle.terminalFailure) return
    reconnectAttemptRef.current = 0
    clearReconnectTimer()
    setConnectionOverlay(null)
  })
  rfb.addEventListener('disconnect', (event: Event) => {
    if (lifecycle.disposed || lifecycle.terminalFailure) return
    if ((event as DisconnectEvent).detail?.clean) {
      setConnectionOverlay({ tone: 'info', text: 'Display disconnected.' })
      return
    }
    scheduleReconnect()
  })
  rfb.addEventListener('securityfailure', (event: Event) => {
    if (lifecycle.disposed) return
    lifecycle.terminalFailure = true
    clearReconnectTimer()
    const reason = (event as SecurityFailureEvent).detail?.reason
    const status = (event as SecurityFailureEvent).detail?.status
    setConnectionOverlay({
      tone: 'error',
      text: reason
        ? `Security handshake failed: ${reason}`
        : status
          ? `Security handshake failed (code ${status}).`
          : 'Security handshake failed.',
    })
  })
  rfb.addEventListener('credentialsrequired', () => {
    if (lifecycle.disposed) return
    lifecycle.terminalFailure = true
    clearReconnectTimer()
    setConnectionOverlay({ tone: 'error', text: 'Display requested credentials.' })
  })
}

function detachAndDisconnect(
  rfb: RFB,
  rfbRef: React.MutableRefObject<RFB | null>,
  screen: HTMLDivElement,
) {
  rfb.disconnect()
  if (rfbRef.current === rfb) rfbRef.current = null
  screen.replaceChildren()
}

/* ── Connection overlay ── */

function VncConnectionOverlay({ overlay }: { overlay: OverlayState }) {
  if (!overlay) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-3">
      <div
        className={cn(
          'max-w-full rounded-md border px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur-md',
          overlay.tone === 'error'
            ? 'status-banner-danger'
            : 'border-line bg-overlay text-ink',
        )}
      >
        {overlay.text}
      </div>
    </div>
  )
}

/* ── Main component ── */

export function VncViewer({
  url = DEFAULT_VNC_URL,
  className,
  interactive = true,
}: VncViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RFB | null>(null)
  const interactiveRef = useRef(interactive)
  const isVisible = useDocumentVisibility()
  const [inViewport, setInViewport] = useState(false)

  // Stop framebuffer traffic and decoding for hidden routes and off-screen tiles.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new IntersectionObserver(([entry]) => {
      setInViewport(entry.isIntersecting)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useFullscreenKey(interactive, containerRef)
  useSyncInteractive(interactive, rfbRef, interactiveRef)
  const { connectionOverlay } = useRfbConnection(isVisible && inViewport, url, screenRef, rfbRef, interactiveRef)

  return (
    <div
      ref={containerRef}
      className={cn('bg-overlay-strong relative h-full w-full overflow-hidden', className)}
    >
      <div
        ref={screenRef}
        className={cn('absolute inset-0 h-full w-full', !interactive && 'pointer-events-none')}
      />
      <VncConnectionOverlay overlay={connectionOverlay} />
    </div>
  )
}
