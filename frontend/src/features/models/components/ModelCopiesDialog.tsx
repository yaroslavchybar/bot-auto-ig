import { AuthenticatedImage } from '@/components/shared/AuthenticatedImage'
import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ModelContentItem } from '../types'

function CopyThumb({
  modelId,
  item,
  name,
}: {
  modelId: string
  item: ModelContentItem
  name: string
}) {
  return (
    <AuthenticatedImage
      path={
        '/api/ig-accounts/models/' +
        encodeURIComponent(modelId) +
        '/content/' +
        item.kind +
        '/' +
        encodeURIComponent(item.id) +
        '/copies/' +
        encodeURIComponent(name) +
        '/image?thumbnail=1'
      }
      alt={name}
      className="aspect-square w-full rounded-lg object-cover"
    />
  )
}

type ModelCopiesDialogProps = {
  modelId: string
  item: ModelContentItem | null
  onClose: () => void
}

export function ModelCopiesDialog(props: ModelCopiesDialogProps) {
  const key = props.item ? `${props.modelId}:${props.item.kind}:${props.item.id}` : 'closed'
  return <ModelCopiesContent key={key} {...props} />
}

function ModelCopiesContent({ modelId, item, onClose }: ModelCopiesDialogProps) {
  const [copies, setCopies] = useState<string[] | null>(null)

  useEffect(() => {
    if (!item) return
    const controller = new AbortController()
    void apiFetch<string[]>(
      `/api/ig-accounts/models/${encodeURIComponent(modelId)}/content/${item.kind}/${encodeURIComponent(item.id)}/copies`,
      { signal: controller.signal },
    )
      .then((rows) => {
        if (!controller.signal.aborted) setCopies(rows)
      })
      .catch(() => {
        if (!controller.signal.aborted) setCopies([])
      })
    return () => controller.abort()
  }, [modelId, item])

  return (
    <Dialog
      open={Boolean(item)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col border-line bg-panel text-ink sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="truncate">
            {item?.name} · {copies === null ? 'loading copies...' : `${copies.length} copies`}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {copies === null ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4" /> Loading copies...
            </div>
          ) : copies.length === 0 ? (
            <p className="px-1 py-8 text-center text-sm text-subtle-copy">No copies found.</p>
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
