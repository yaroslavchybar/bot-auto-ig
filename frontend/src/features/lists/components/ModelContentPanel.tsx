import { useEffect, useState } from 'react'
import { CircleAlert, Images, Layers, RefreshCw, Trash2, Upload, UserRound } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog'
import { ModelCopiesDialog } from './ModelCopiesDialog'
import { ModelImage } from './ModelImage'
import type { List, ModelContentItem } from '../types'

const kinds = [
  { kind: 'posts' as const, label: 'Post images', icon: Images },
  { kind: 'avatars' as const, label: 'Avatars', icon: UserRound },
]

export function ModelContentPanel({ model, onUploaded }: { model: List; onUploaded: () => void }) {
  const [items, setItems] = useState<ModelContentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [viewer, setViewer] = useState<ModelContentItem | null>(null)
  const [deleting, setDeleting] = useState<ModelContentItem | null>(null)
  const [deleteSaving, setDeleteSaving] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [error, setError] = useState('')
  const contentPath = `/api/ig-accounts/models/${encodeURIComponent(model.id)}/content`

  async function reload() {
    setItems(await apiFetch<ModelContentItem[]>(contentPath))
  }

  useEffect(() => {
    let active = true
    void apiFetch<ModelContentItem[]>(contentPath)
      .then((rows) => { if (active) setItems(rows) })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [contentPath])

  async function upload(kind: 'posts' | 'avatars', file: File) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await apiFetch(`${contentPath}/${kind}?name=${encodeURIComponent(file.name)}`,
        { method: 'POST', body: file })
      await reload()
      onUploaded()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function generateCopies(item: ModelContentItem) {
    if (generatingId) return
    setGeneratingId(item.id)
    setError('')
    try {
      await apiFetch(`${contentPath}/${item.kind}/${encodeURIComponent(item.id)}/copies`,
        { method: 'POST', timeout: 30 * 60_000 })
      await reload()
      onUploaded()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGeneratingId(null)
    }
  }

  async function removeImage() {
    if (!deleting || deleteSaving) return
    setDeleteSaving(true)
    setDeleteError(null)
    try {
      await apiFetch(`${contentPath}/${deleting.kind}/${encodeURIComponent(deleting.id)}`,
        { method: 'DELETE' })
      setDeleting(null)
      await reload()
      onUploaded()
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleteSaving(false)
    }
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-subtle-copy text-xs">{model.name}</p>
          <p className="text-subtle-copy mt-1 text-sm">Upload an image, then generate 50 copies for this model's accounts.</p>
        </div>
        {kinds.map(({ kind }) => (
          <Button key={kind} size="sm" variant="outline" disabled={busy}
            className="button-panel h-8 font-medium" asChild>
            <label className="cursor-pointer">
              <Upload className="h-3.5 w-3.5" />
              {busy ? 'Processing...' : `Upload ${kind === 'posts' ? 'post' : 'avatar'}`}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
                disabled={busy} onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void upload(kind, file)
                }} />
            </label>
          </Button>
        ))}
      </div>

      {error && (
        <div role="alert" className="text-status-danger bg-status-danger-soft border-status-danger-border mb-4 flex items-start gap-2 rounded-xl border px-4 py-2.5 text-sm">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{error}</span>
        </div>
      )}
      {loading ? (
        <div className="text-muted-foreground flex animate-pulse items-center justify-center gap-2 p-6 text-sm">
          <RefreshCw className="h-4 w-4 animate-spin" /> Loading content...
        </div>
      ) : (
        <div className="space-y-6">
          {kinds.map(({ kind, label, icon: Icon }) => {
            const rows = items.filter((item) => item.kind === kind)
            return (
              <section key={kind}>
                <div className="mb-3 flex items-center gap-2">
                  <Icon className="text-copy h-4 w-4" />
                  <h3 className="text-copy text-sm font-semibold">{label}</h3>
                  <span className="text-subtle-copy text-xs">{rows.length}</span>
                </div>
                {rows.length === 0 ? (
                  <p className="text-subtle-copy border-line-soft rounded-xl border-2 border-dashed px-3 py-8 text-center text-sm">
                    No {kind === 'posts' ? 'post images' : 'avatars'} yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {rows.map((item) => {
                      const generating = generatingId === item.id
                      const hasCopies = item.variantCount > 0
                      return (
                        <div key={item.id} className="bg-panel border-line-soft min-w-0 overflow-hidden rounded-xl border">
                          <div className="bg-panel-muted relative aspect-square overflow-hidden">
                            {hasCopies ? (
                              <button type="button" onClick={() => setViewer(item)}
                                title="View all copies" className="block h-full w-full cursor-zoom-in">
                                <ModelImage modelId={model.id} item={item} className="h-full w-full object-cover" />
                              </button>
                            ) : (
                              <ModelImage modelId={model.id} item={item} className="h-full w-full object-cover" />
                            )}
                            <div className="absolute top-1.5 right-1.5 flex gap-1.5">
                              {!hasCopies && (
                                <button type="button" onClick={() => void generateCopies(item)}
                                  disabled={generating || busy} title="Generate 50 copies"
                                  aria-label={`Generate copies for ${item.name}`}
                                  className="rounded-lg bg-black/60 p-1.5 text-white transition-colors hover:bg-black/80 disabled:opacity-50">
                                  {generating
                                    ? <RefreshCw className="h-4 w-4 animate-spin" />
                                    : <Layers className="h-4 w-4" />}
                                </button>
                              )}
                              <button type="button" onClick={() => { setDeleteError(null); setDeleting(item) }}
                                disabled={busy || generating} title="Delete image"
                                aria-label={`Delete ${item.name}`}
                                className="rounded-lg bg-black/60 p-1.5 text-white transition-colors hover:bg-black/80 disabled:opacity-50">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                          <div className="p-2">
                            <p className="text-ink truncate text-xs" title={item.name}>{item.name}</p>
                            <p className="text-subtle-copy mt-0.5 text-[11px] tabular-nums">
                              {generating
                                ? 'Generating copies...'
                                : hasCopies ? `${item.usedCount}/${item.variantCount} used` : 'No copies yet'}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
      <ModelCopiesDialog modelId={model.id} item={viewer} onClose={() => setViewer(null)} />
      <ConfirmDeleteDialog open={Boolean(deleting)} title="Delete image"
        entityLabel={deleting && deleting.variantCount > 0 ? `and its ${deleting.variantCount} copies` : ''}
        itemName={deleting?.name ?? ''} confirmLabel="Delete"
        saving={deleteSaving} error={deleteError}
        extraDescription={deleting && deleting.usedCount > 0
          ? `${deleting.usedCount} copies are already assigned to accounts. Used posts stay published; the rest will be gone.`
          : undefined}
        onConfirm={() => void removeImage()}
        onCancel={() => { if (!deleteSaving) setDeleting(null) }} />
    </div>
  )
}
