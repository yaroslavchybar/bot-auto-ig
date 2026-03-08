import { useEffect, useRef, useState } from 'react'
import RFB from '@novnc/novnc/lib/rfb.js'
import { cn } from '@/lib/utils'
import { buildVncWebSocketUrl } from './vnc-url'

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

export function VncViewer({ url = DEFAULT_VNC_URL, className, interactive = true }: VncViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RFB | null>(null)
  const interactiveRef = useRef(interactive)
  const reconnectTimerRef = useRef<number | null>(null)
  const reconnectAttemptRef = useRef(0)
  const [connectionOverlay, setConnectionOverlay] = useState<OverlayState>({
    tone: 'info',
    text: 'Connecting to display...',
  })
  const [reconnectKey, setReconnectKey] = useState(0)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!interactive) {
        return
      }

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
          containerRef.current?.requestFullscreen().catch(err => {
            console.error(`Error attempting to enable fullscreen: ${err.message}`)
          })
        } else {
          document.exitFullscreen()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [interactive])

  useEffect(() => {
    interactiveRef.current = interactive

    const rfb = rfbRef.current
    if (!rfb) {
      return
    }

    rfb.viewOnly = !interactive
    rfb.focusOnClick = interactive
  }, [interactive])

  useEffect(() => {
    const screen = screenRef.current
    if (!screen) {
      return
    }

    let disposed = false
    let terminalFailure = false

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }

    const scheduleReconnect = () => {
      if (disposed || reconnectTimerRef.current !== null) {
        return
      }

      reconnectAttemptRef.current += 1
      setConnectionOverlay({
        tone: 'info',
        text: reconnectAttemptRef.current > 1
          ? `Connection lost. Retrying (${reconnectAttemptRef.current})...`
          : 'Connection lost. Reconnecting...',
      })
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null
        setReconnectKey(current => current + 1)
      }, RECONNECT_DELAY_MS)
    }

    screen.replaceChildren()
    setConnectionOverlay({
      tone: 'info',
      text: reconnectAttemptRef.current > 0 ? 'Reconnecting to display...' : 'Connecting to display...',
    })

    const rfb = new RFB(screen, url)
    rfbRef.current = rfb
    rfb.background = 'rgb(0, 0, 0)'
    rfb.scaleViewport = true
    rfb.resizeSession = false
    rfb.focusOnClick = interactiveRef.current
    rfb.viewOnly = !interactiveRef.current

    const handleConnect = () => {
      reconnectAttemptRef.current = 0
      clearReconnectTimer()
      setConnectionOverlay(null)
    }

    const handleDisconnect = (event: Event) => {
      if (disposed) {
        return
      }

      if (terminalFailure) {
        return
      }

      if ((event as DisconnectEvent).detail?.clean) {
        setConnectionOverlay({
          tone: 'info',
          text: 'Display disconnected.',
        })
        return
      }

      scheduleReconnect()
    }

    const handleSecurityFailure = (event: Event) => {
      if (disposed) {
        return
      }

      terminalFailure = true
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
    }

    const handleCredentialsRequired = () => {
      if (disposed) {
        return
      }

      terminalFailure = true
      setConnectionOverlay({
        tone: 'error',
        text: 'Display requested credentials.',
      })
    }

    rfb.addEventListener('connect', handleConnect)
    rfb.addEventListener('disconnect', handleDisconnect)
    rfb.addEventListener('securityfailure', handleSecurityFailure)
    rfb.addEventListener('credentialsrequired', handleCredentialsRequired)

    return () => {
      disposed = true
      clearReconnectTimer()
      rfb.removeEventListener('connect', handleConnect)
      rfb.removeEventListener('disconnect', handleDisconnect)
      rfb.removeEventListener('securityfailure', handleSecurityFailure)
      rfb.removeEventListener('credentialsrequired', handleCredentialsRequired)
      rfb.disconnect()
      if (rfbRef.current === rfb) {
        rfbRef.current = null
      }
      screen.replaceChildren()
    }
  }, [reconnectKey, url])

  return (
    <div ref={containerRef} className={cn('relative w-full h-full bg-black overflow-hidden', className)}>
      <div
        ref={screenRef}
        className={cn('absolute inset-0 h-full w-full', !interactive && 'pointer-events-none')}
      />

      {connectionOverlay ? (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-3">
          <div
            className={cn(
              'max-w-full rounded-md border px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur-md',
              connectionOverlay.tone === 'error'
                ? 'border-red-500/30 bg-red-950/70 text-red-200'
                : 'border-white/10 bg-black/65 text-gray-200'
            )}
          >
            {connectionOverlay.text}
          </div>
        </div>
      ) : null}
    </div>
  )
}
