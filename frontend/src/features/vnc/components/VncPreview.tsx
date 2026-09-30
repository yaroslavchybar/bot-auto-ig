import { useEffect, useRef, useState } from 'react'
import { apiFetchBlob } from '@/lib/api'
import { useNearViewport } from '@/hooks/use-near-viewport'
import { useDocumentVisibility } from '@/hooks/use-document-visibility'

export function VncPreview({ vncPort }: { vncPort: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const inViewport = useNearViewport(ref, '0px')
  const tabVisible = useDocumentVisibility()
  const visible = inViewport && tabVisible
  return (
    <div ref={ref} className="relative flex min-h-[200px] items-center justify-center bg-overlay">
      {visible ? (
        <PreviewImage key={vncPort} vncPort={vncPort} />
      ) : (
        <span className="text-xs text-subtle-copy">Preview paused</span>
      )}
    </div>
  )
}

function PreviewImage({ vncPort }: { vncPort: number }) {
  const [preview, setPreview] = useState<{ port: number; image: string } | null>(null)
  const [failed, setFailed] = useState(false)

  // Leaving the viewport unmounts this loader and releases the snapshot.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.image)
    }
  }, [preview])

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    const refresh = async () => {
      try {
        const result = await apiFetchBlob(`/api/displays/${vncPort}/preview`, {
          signal: controller.signal,
          maxRetries: 1,
          timeout: 15000,
        })
        if (!disposed) {
          setPreview({ port: vncPort, image: URL.createObjectURL(result) })
          setFailed(false)
        }
      } catch {
        if (!disposed) setFailed(true)
      } finally {
        if (!disposed)
          timer = setTimeout(() => {
            void refresh()
          }, 10000)
      }
    }
    // Spread initial captures when a whole grid becomes visible at once.
    timer = setTimeout(() => {
      void refresh()
    }, Math.random() * 1000)
    return () => {
      disposed = true
      controller.abort()
      clearTimeout(timer)
    }
  }, [vncPort])

  const image = preview?.port === vncPort ? preview.image : null
  return (
    <>
      {image ? (
        <img src={image} alt="Remote desktop preview" className="w-full object-contain" />
      ) : (
        <span className="text-xs text-subtle-copy">
          {failed ? 'Preview unavailable — open session' : 'Loading preview…'}
        </span>
      )}
      {image && (
        <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-[10px] text-white">
          {failed ? 'Preview paused' : 'Preview · updates every 10s'}
        </span>
      )}
    </>
  )
}
