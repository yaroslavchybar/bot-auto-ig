import { useEffect, useRef, useState } from 'react'
import { apiFetchBlob } from '@/lib/api'
import { useNearViewport } from '@/hooks/use-near-viewport'
import { useDocumentVisibility } from '@/hooks/use-document-visibility'

export function AuthenticatedImage(props: { path: string; alt: string; className?: string }) {
  return <ObservedImage key={props.path} {...props} />
}

function ObservedImage({
  path,
  alt,
  className,
}: {
  path: string
  alt: string
  className?: string
}) {
  const container = useRef<HTMLSpanElement>(null)
  const nearScreen = useNearViewport(container)
  const tabVisible = useDocumentVisibility()
  return (
    <span
      ref={container}
      className={`relative block overflow-hidden bg-panel-muted ${className ?? ''}`}
    >
      {nearScreen && tabVisible && <ImageContent path={path} alt={alt} />}
    </span>
  )
}

function ImageContent({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let objectUrl = ''
    void apiFetchBlob(path, { signal: controller.signal })
      .then((blob) => {
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path])

  return (
    <>
      {url && <img src={url} alt={alt} decoding="async" className="h-full w-full object-cover" />}
      {failed && (
        <span
          role="status"
          className="absolute inset-0 flex items-center justify-center text-xs text-muted-copy"
        >
          Image unavailable
        </span>
      )}
    </>
  )
}
