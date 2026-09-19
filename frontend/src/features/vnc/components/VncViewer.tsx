import { useEffect, useRef, useState } from 'react'
import RFB from '@novnc/novnc'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Maximize, Minimize } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useViewerVisibility } from '../hooks/useViewerVisibility'
import { buildVncWebSocketUrl } from '../utils/buildVncWebSocketUrl'
import { attachClipboardBridge } from '../utils/clipboardBridge'
import { attachRfbListeners, type OverlayState } from '../utils/connectionEvents'

interface VncViewerProps {
  vncPort: number
  url?: string
  className?: string
  interactive?: boolean
}

const RECONNECT_DELAY_MS = 1500
type ClipboardBridge = ReturnType<typeof attachClipboardBridge>

/* ── Sync interactive state to RFB ── */

function useSyncInteractive(
  interactive: boolean,
  rfbRef: React.RefObject<RFB | null>,
  interactiveRef: React.MutableRefObject<boolean>,
  clipboardRef: React.RefObject<ClipboardBridge | null>,
) {
  useEffect(() => {
    interactiveRef.current = interactive
    clipboardRef.current?.cancel()
    const rfb = rfbRef.current
    if (!rfb) return
    rfb.viewOnly = !interactive
    rfb.focusOnClick = interactive
  }, [interactive, rfbRef, interactiveRef, clipboardRef])
}

/* ── RFB connection lifecycle ── */

function useRfbConnection(
  enabled: boolean,
  url: string,
  vncPort: number,
  screenRef: React.RefObject<HTMLDivElement | null>,
  rfbRef: React.MutableRefObject<RFB | null>,
  interactiveRef: React.MutableRefObject<boolean>,
  clipboardRef: React.MutableRefObject<ClipboardBridge | null>,
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
    let connected = false
    rfb.addEventListener('connect', () => { connected = true })
    rfb.addEventListener('disconnect', () => {
      connected = false
      if (!lifecycle.disposed) clipboardRef.current?.cancel()
    })
    const clipboard = attachClipboardBridge({
      screen,
      rfb,
      canInteract: () => connected && interactiveRef.current,
      clipboard: navigator.clipboard,
      writeRemoteText: (text, signal) => apiFetch(`/api/displays/${vncPort}/clipboard`, {
        method: 'POST',
        body: { text },
        signal,
      }),
      onError: (message) => toast.error(message, { id: `clipboard-${vncPort}` }),
    })
    clipboardRef.current = clipboard

    return () => {
      lifecycle.disposed = true
      clearReconnectTimer()
      clipboard.dispose()
      if (clipboardRef.current === clipboard) clipboardRef.current = null
      detachAndDisconnect(rfb, rfbRef, screen)
    }
  }, [enabled, reconnectKey, url, vncPort, screenRef, rfbRef, interactiveRef, clipboardRef])

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
  vncPort,
  url = buildVncWebSocketUrl(vncPort),
  className,
  interactive = true,
}: VncViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RFB | null>(null)
  const interactiveRef = useRef(interactive)
  const clipboardRef = useRef<ClipboardBridge | null>(null)
  const { enabled, visible } = useViewerVisibility(containerRef, 3000)
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])
  const toggleFullscreen = async (button: HTMLElement | null) => {
    try {
      if (document.fullscreenElement === containerRef.current) await document.exitFullscreen()
      else await containerRef.current?.requestFullscreen()
    } catch {
      toast.error('Fullscreen is unavailable in this browser')
    } finally {
      button?.blur()
    }
  }

  useSyncInteractive(interactive && visible, rfbRef, interactiveRef, clipboardRef)
  const { connectionOverlay } = useRfbConnection(enabled, url, vncPort, screenRef, rfbRef, interactiveRef, clipboardRef)

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
      <Button
        type="button" variant="outline" size="icon"
        className="absolute top-2 right-2 z-10 h-8 w-8"
        aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        title={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        onClick={(event) => void toggleFullscreen(event.currentTarget)}
      >
        {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
      </Button>
    </div>
  )
}
