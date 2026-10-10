import { useState } from 'react'
import { CircleAlert, Eye, Images, Layers, Loader2, Trash2, Upload, UserRound } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog'
import { useModelContent } from '../hooks/useModelContent'
import { ModelCopiesDialog } from './ModelCopiesDialog'
import { ModelImage } from './ModelImage'
import type { List, ModelContentItem } from '../types'

type Kind = ModelContentItem['kind']

const sections: { kind: Kind; label: string; uploadLabel: string; icon: LucideIcon }[] = [
  { kind: 'posts', label: 'Post images', uploadLabel: 'Upload post', icon: Images },
  { kind: 'avatars', label: 'Avatars', uploadLabel: 'Upload avatar', icon: UserRound },
]

// Image bank for one model. Post images and avatars each get a card with their own upload button.
export function ModelContentPanel({ model }: { model: List }) {
  const { items, loading, error: loadError, reload } = useModelContent(model.id)
  const [uploading, setUploading] = useState<Kind | null>(null)
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [viewer, setViewer] = useState<ModelContentItem | null>(null)
  const [deleting, setDeleting] = useState<ModelContentItem | null>(null)
  const [deleteSaving, setDeleteSaving] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [error, setError] = useState('')
  const contentPath = `/api/ig-accounts/models/${encodeURIComponent(model.id)}/content`

  // Uploads one image of the given kind, then reloads the bank.
  async function upload(kind: Kind, file: File) {
    if (uploading) return
    setUploading(kind)
    setError('')
    try {
      await apiFetch(`${contentPath}/${kind}?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        body: file,
      })
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(null)
    }
  }

  // Generates 50 copies for one image. Only one image can generate at a time.
  async function generateCopies(item: ModelContentItem) {
    if (generatingId) return
    setGeneratingId(item.id)
    setError('')
    try {
      await apiFetch(`${contentPath}/${item.kind}/${encodeURIComponent(item.id)}/copies`, {
        method: 'POST',
        timeout: 30 * 60_000,
      })
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGeneratingId(null)
    }
  }

  // Deletes the image chosen in the confirm dialog, then reloads the bank.
  async function removeImage() {
    if (!deleting || deleteSaving) return
    setDeleteSaving(true)
    setDeleteError(null)
    try {
      await apiFetch(`${contentPath}/${deleting.kind}/${encodeURIComponent(deleting.id)}`, {
        method: 'DELETE',
      })
      setDeleting(null)
      await reload()
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleteSaving(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-5 sm:p-6">
      <p className="text-sm text-subtle-copy">
        Upload an image, then generate 50 copies for this model's accounts.
      </p>

      {(error || loadError) && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-status-danger-border bg-status-danger-soft px-4 py-2.5 text-sm text-status-danger"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{error || loadError}</span>
          {loadError && (
            <Button size="sm" variant="outline" onClick={() => void reload().catch(() => {})}>
              Retry
            </Button>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-subtle-copy">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading content...
        </div>
      ) : (
        sections.map(({ kind, label, uploadLabel, icon: Icon }) => {
          const rows = items.filter((item) => item.kind === kind)
          return (
            <section
              key={kind}
              className="overflow-hidden rounded-xl border border-line-soft bg-panel"
            >
              <header className="flex items-center gap-3 border-b border-line-soft px-4 py-3">
                <Icon className="h-4 w-4 text-copy" />
                <h4 className="text-sm font-semibold text-ink">{label}</h4>
                <span className="rounded-md bg-panel-muted px-1.5 text-xs text-subtle-copy tabular-nums">
                  {rows.length}
                </span>
                <div className="ml-auto">
                  <UploadButton
                    label={uploadLabel}
                    uploading={uploading === kind}
                    disabled={uploading !== null}
                    onFile={(file) => void upload(kind, file)}
                  />
                </div>
              </header>

              <div className="p-4">
                {rows.length === 0 ? (
                  <p className="rounded-lg border-2 border-dashed border-line-soft px-3 py-10 text-center text-sm text-subtle-copy">
                    No {label.toLowerCase()} yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {rows.map((item) => (
                      <ContentTile
                        key={item.id}
                        modelId={model.id}
                        item={item}
                        generating={generatingId === item.id}
                        busy={uploading !== null || generatingId !== null}
                        onGenerate={() => void generateCopies(item)}
                        onView={() => setViewer(item)}
                        onDelete={() => {
                          setDeleteError(null)
                          setDeleting(item)
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>
          )
        })
      )}

      <ModelCopiesDialog modelId={model.id} item={viewer} onClose={() => setViewer(null)} />
      <ConfirmDeleteDialog
        open={Boolean(deleting)}
        title="Delete image"
        entityLabel={
          deleting && deleting.variantCount > 0 ? `and its ${deleting.variantCount} copies` : ''
        }
        itemName={deleting?.name ?? ''}
        confirmLabel="Delete"
        saving={deleteSaving}
        error={deleteError}
        extraDescription={
          deleting && deleting.usedCount > 0
            ? `${deleting.usedCount} copies are already assigned to accounts. Used posts stay published; the rest will be gone.`
            : undefined
        }
        onConfirm={() => void removeImage()}
        onCancel={() => {
          if (!deleteSaving) setDeleting(null)
        }}
      />
    </div>
  )
}

// One image in the bank. Shows copy status and the next action: generate copies, or view them once they exist.
function ContentTile({
  modelId,
  item,
  generating,
  busy,
  onGenerate,
  onView,
  onDelete,
}: {
  modelId: string
  item: ModelContentItem
  generating: boolean
  busy: boolean
  onGenerate: () => void
  onView: () => void
  onDelete: () => void
}) {
  const hasCopies = item.variantCount > 0
  const locked = busy || generating
  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line-soft">
      <div className="relative aspect-square bg-panel-muted">
        <ModelImage modelId={modelId} item={item} className="h-full w-full object-cover" />
        {generating && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 p-2.5">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-ink" title={item.name}>
            {item.name}
          </p>
          <p className="text-[11px] text-subtle-copy tabular-nums">
            {generating
              ? 'Generating copies...'
              : hasCopies
                ? `${item.usedCount}/${item.variantCount} used`
                : 'No copies yet'}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {hasCopies ? (
            <Button variant="outline" className="flex-1 button-panel" onClick={onView}>
              <Eye /> View copies
            </Button>
          ) : (
            <Button
              className="flex-1 brand-button font-medium"
              disabled={locked}
              onClick={onGenerate}
            >
              <Layers /> Generate 50
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            title="Delete image"
            aria-label={`Delete ${item.name}`}
            disabled={locked}
            onClick={onDelete}
          >
            <Trash2 className="text-status-danger" />
          </Button>
        </div>
      </div>
    </article>
  )
}

// File button that uploads an image. The input is disabled directly because a disabled label still takes clicks.
function UploadButton({
  label,
  uploading,
  disabled,
  onFile,
}: {
  label: string
  uploading: boolean
  disabled: boolean
  onFile: (file: File) => void
}) {
  return (
    <Button
      variant="outline"
      size="lg"
      asChild
      className={cn('button-panel shrink-0', disabled && 'pointer-events-none opacity-50')}
    >
      <label className="cursor-pointer focus-within:ring-2 focus-within:ring-ring/60">
        {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
        {uploading ? 'Processing...' : label}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onFile(file)
          }}
        />
      </label>
    </Button>
  )
}
