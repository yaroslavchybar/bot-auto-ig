import { useEffect, useState } from 'react'
import { apiFetchBlob } from '@/lib/api'
import type { ModelContentItem } from '../types'

type ModelImageProps = {
  modelId: string
  item: ModelContentItem
  className?: string
}

export function ModelImage(props: ModelImageProps) {
  return <ModelImageContent key={`${props.modelId}:${props.item.kind}:${props.item.id}`} {...props} />
}

function ModelImageContent({ modelId, item, className }: ModelImageProps) {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let objectUrl = ''
    void apiFetchBlob(
      `/api/ig-accounts/models/${encodeURIComponent(modelId)}/content/${item.kind}/${encodeURIComponent(item.id)}/image`,
      { signal: controller.signal },
    ).then((blob) => {
      if (controller.signal.aborted) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [modelId, item.id, item.kind])

  if (url) return <img src={url} alt={item.name} className={className} />
  if (failed) return <span role="status" className={`${className ?? ''} text-muted-copy flex items-center justify-center text-xs`}>Image unavailable</span>
  return null
}
