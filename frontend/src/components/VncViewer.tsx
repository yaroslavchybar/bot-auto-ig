import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

interface VncViewerProps {
  url?: string
  className?: string
  interactive?: boolean
}

const DEFAULT_VNC_URL =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:6080/vnc.html`
    : 'http://localhost:6080/vnc.html'

export function VncViewer({ url = DEFAULT_VNC_URL, className, interactive = true }: VncViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!interactive) {
        return
      }

      // Ignore if typing in an input
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

  return (
    <div ref={containerRef} className={cn('relative w-full h-full bg-black overflow-hidden', className)}>
      <iframe
        src={url + '?autoconnect=true&resize=scale&reconnect=true'}
        className={cn('absolute inset-0 w-full h-full border-0', !interactive && 'pointer-events-none')}
        title="VNC Viewer"
        allow="fullscreen"
      />
    </div>
  )
}

