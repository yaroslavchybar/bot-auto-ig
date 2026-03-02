import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

interface VncViewerProps {
  url?: string
  className?: string
}

const DEFAULT_VNC_URL =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:6080/vnc.html`
    : 'http://localhost:6080/vnc.html'

export function VncViewer({ url = DEFAULT_VNC_URL, className }: VncViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
  }, [])

  return (
    <div ref={containerRef} className={cn('relative w-full h-full bg-black overflow-hidden', className)}>
      <iframe
        src={url + '?autoconnect=true&resize=scale&reconnect=true'}
        className="absolute inset-0 w-full h-full border-0"
        title="VNC Viewer"
        allow="fullscreen"
      />
    </div>
  )
}

