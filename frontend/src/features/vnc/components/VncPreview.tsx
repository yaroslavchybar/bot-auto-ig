import { useEffect, useRef, useState } from 'react'
import { apiFetchBlob } from '@/lib/api'
import { useViewerVisibility } from '../hooks/useViewerVisibility'

export function VncPreview({ vncPort }: { vncPort: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const { visible } = useViewerVisibility(ref)
  const [preview, setPreview] = useState<{ port: number; image: string } | null>(null)
  const [failed, setFailed] = useState(false)

  // Retain the snapshot while hidden; release it after replacement or unmount.
  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview.image) }
  }, [preview])

  useEffect(() => {
    if (!visible) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    const refresh = async () => {
      try {
        const result = await apiFetchBlob(`/api/displays/${vncPort}/preview`, {
          signal: controller.signal, maxRetries: 1, timeout: 15000,
        })
        if (!disposed) {
          setPreview({ port: vncPort, image: URL.createObjectURL(result) })
          setFailed(false)
        }
      } catch {
        if (!disposed) setFailed(true)
      } finally {
        if (!disposed) timer = setTimeout(() => { void refresh() }, 10000)
      }
    }
    // Spread initial captures when a whole grid becomes visible at once.
    timer = setTimeout(() => { void refresh() }, Math.random() * 1000)
    return () => {
      disposed = true
      controller.abort()
      clearTimeout(timer)
    }
  }, [visible, vncPort])

  const image = preview?.port === vncPort ? preview.image : null
  return (
    <div ref={ref} className="bg-overlay relative flex min-h-[200px] items-center justify-center">
      {image ? <img src={image} alt="Remote desktop preview" className="w-full object-contain" /> : (
        <span className="text-subtle-copy text-xs">{failed ? 'Preview unavailable — open session' : 'Loading preview…'}</span>
      )}
      {image && <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-[10px] text-white">
        {failed ? 'Preview paused' : 'Preview · updates every 10s'}
      </span>}
    </div>
  )
}
