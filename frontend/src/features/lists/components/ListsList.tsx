import { useEffect, useState } from 'react'
import { Images, MoreHorizontal, Pencil, RefreshCw, Trash2, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { apiFetch } from '@/lib/api'
import { ModelImage } from './ModelImage'
import type { List, ModelContentItem } from '../types'

interface ListsListProps {
  lists: List[]
  loading: boolean
  refreshKey: number
  onOpenContent: (list: List) => void
  onEdit: (list: List) => void
  onDelete: (list: List) => void
}

function ModelCard({ model, refreshKey, onOpenContent, onEdit, onDelete }: {
  model: List
  refreshKey: number
  onOpenContent: (model: List) => void
  onEdit: (model: List) => void
  onDelete: (model: List) => void
}) {
  const [items, setItems] = useState<ModelContentItem[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    void apiFetch<ModelContentItem[]>(`/api/ig-accounts/models/${encodeURIComponent(model.id)}/content`)
      .then((rows) => { if (active) { setItems(rows); setError(false) } })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [model.id, refreshKey])

  const avatars = items.filter((item) => item.kind === 'avatars')
  const posts = items.filter((item) => item.kind === 'posts')
  const cover = avatars.at(-1) ?? posts.at(-1)

  return (
    <article className="bg-panel-subtle border-line-soft group overflow-hidden rounded-2xl border shadow-xs transition-colors hover:border-line-strong">
      <button type="button" onClick={() => onOpenContent(model)}
        className="bg-panel-muted relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden text-left">
        {cover ? (
          <ModelImage modelId={model.id} item={cover} className="h-full w-full object-cover" />
        ) : (
          <UserRound className="text-subtle-copy h-16 w-16 opacity-50" />
        )}
        <span className="bg-overlay-strong absolute right-3 bottom-3 rounded-full px-3 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          Open content bank
        </span>
      </button>
      <div className="p-4">
        <div className="flex items-start gap-2">
          <button type="button" onClick={() => onOpenContent(model)}
            className="min-w-0 flex-1 text-left focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2">
            <h3 className="text-ink truncate text-base font-semibold">{model.name}</h3>
            <p className="text-subtle-copy mt-0.5 truncate text-sm">
              {model.fullName || 'No full name yet'}
            </p>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-copy hover:bg-panel-muted h-8 w-8 shrink-0" aria-label={`Actions for ${model.name}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="panel-dropdown w-44">
              <DropdownMenuLabel className="text-muted-copy">Actions</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onEdit(model)} className="hover:bg-panel-hover cursor-pointer">
                <Pencil className="mr-2 h-4 w-4" /> Edit model
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDelete(model)}
                className="text-status-danger focus:text-status-danger focus:bg-status-danger-soft cursor-pointer">
                <Trash2 className="mr-2 h-4 w-4" /> Delete model
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="border-line-soft text-subtle-copy mt-4 flex items-center gap-4 border-t pt-3 text-xs">
          <span className="flex items-center gap-1.5"><Images className="h-3.5 w-3.5" /> {posts.length} posts</span>
          <span className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" /> {avatars.length} avatars</span>
          <span className="ml-auto tabular-nums">{model.usernames?.length ?? 0} usernames</span>
        </div>
        {error && <p className="text-status-danger mt-2 text-xs">Could not load content.</p>}
      </div>
    </article>
  )
}

export function ListsList({ lists, loading, refreshKey, onOpenContent, onEdit, onDelete }: ListsListProps) {
  if (loading && lists.length === 0) {
    return (
      <div className="text-muted-foreground flex animate-pulse items-center justify-center gap-2 p-12 text-sm">
        <RefreshCw className="h-4 w-4 animate-spin" /> Loading models...
      </div>
    )
  }

  if (lists.length === 0) {
    return (
      <div className="border-line-soft bg-panel-subtle flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 text-center">
        <UserRound className="text-subtle-copy mb-4 h-10 w-10" />
        <h3 className="text-ink text-lg font-medium">No models</h3>
        <p className="text-subtle-copy mt-1 text-sm">Create a model to group its profiles and content.</p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {lists.map((model) => (
        <ModelCard key={model.id} model={model} refreshKey={refreshKey}
          onOpenContent={onOpenContent} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  )
}
