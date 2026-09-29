import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { apiFetch, apiFetchBlob } from '@/lib/api'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ModelContentItem } from '../types'

function CopyThumb({ modelId, item, name }: { modelId: string; item: ModelContentItem; name: string }) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    let objectUrl = ''
    void apiFetchBlob(
      `/api/ig-accounts/models/${encodeURIComponent(modelId)}/content/${item.kind}/${encodeURIComponent(item.id)}/copies/${encodeURIComponent(name)}/image`,
      { signal: controller.signal },
    ).then((blob) => {
      if (controller.signal.aborted) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }).catch(() => {})
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [modelId, item.id, item.kind, name])

  if (!url) return <div className="bg-panel-muted aspect-square animate-pulse rounded-lg" />
  return <img src={url} alt={name} loading="lazy" className="aspect-square w-full rounded-lg object-cover" />
}

export function ModelCopiesDialog({ modelId, item, onClose }: {
  modelId: string
  item: ModelContentItem | null
  onClose: () => void
}) {
  const [copies, setCopies] = useState<string[] | null>(null)

  useEffect(() => {
    if (!item) return
    const controller = new AbortController()
    setCopies(null)
    void apiFetch<string[]>(
      `/api/ig-accounts/models/${encodeURIComponent(modelId)}/content/${item.kind}/${encodeURIComponent(item.id)}/copies`,
      { signal: controller.signal },
    ).then((rows) => { if (!controller.signal.aborted) setCopies(rows) })
      .catch(() => { if (!controller.signal.aborted) setCopies([]) })
    return () => controller.abort()
  }, [modelId, item])

  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="bg-panel border-line text-ink flex max-h-[90vh] flex-col sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="truncate">
            {item?.name} · {copies === null ? 'loading copies...' : `${copies.length} copies`}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {copies === null ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 p-6 text-sm">
              <RefreshCw className="h-4 w-4 animate-spin" /> Loading copies...
            </div>
          ) : copies.length === 0 ? (
            <p className="text-subtle-copy px-1 py-8 text-center text-sm">No copies found.</p>
          ) : item ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {copies.map((name) => (
                <CopyThumb key={name} modelId={modelId} item={item} name={name} />
              ))}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
