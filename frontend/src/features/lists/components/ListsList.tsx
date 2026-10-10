import { Images, MoreHorizontal, Pencil, RefreshCw, Trash2, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useModelContent } from '../hooks/useModelContent'
import { ModelImage } from './ModelImage'
import type { List } from '../types'

interface ListsListProps {
  lists: List[]
  loading: boolean
  onOpenContent: (list: List) => void
  onEdit: (list: List) => void
  onDelete: (list: List) => void
}

function ModelCard({
  model,
  onOpenContent,
  onEdit,
  onDelete,
}: {
  model: List
  onOpenContent: (model: List) => void
  onEdit: (model: List) => void
  onDelete: (model: List) => void
}) {
  const { items, error } = useModelContent(model.id)

  const avatars = items.filter((item) => item.kind === 'avatars')
  const posts = items.filter((item) => item.kind === 'posts')
  const cover = avatars.at(-1) ?? posts.at(-1)

  return (
    <article className="group overflow-hidden rounded-2xl border border-line-soft bg-panel-subtle shadow-xs hover:border-line-strong">
      <button
        type="button"
        onClick={() => onOpenContent(model)}
        className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-panel-muted text-left"
      >
        {cover ? (
          <ModelImage modelId={model.id} item={cover} className="h-full w-full object-cover" />
        ) : (
          <UserRound className="h-16 w-16 text-subtle-copy opacity-50" />
        )}
        <span className="absolute right-3 bottom-3 rounded-full bg-overlay-strong px-3 py-1 text-xs text-white opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          Open content bank
        </span>
      </button>
      <div className="p-4">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => onOpenContent(model)}
            className="min-w-0 flex-1 text-left focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <h3 className="truncate text-base font-semibold text-ink">{model.name}</h3>
            <p className="mt-0.5 truncate text-sm text-subtle-copy">
              {model.fullName || 'No full name yet'}
            </p>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-copy hover:bg-panel-muted"
                aria-label={`Actions for ${model.name}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 panel-dropdown">
              <DropdownMenuLabel className="text-muted-copy">Actions</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => onEdit(model)}
                className="cursor-pointer hover:bg-panel-hover"
              >
                <Pencil className="mr-2 h-4 w-4" /> Edit model
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDelete(model)}
                className="cursor-pointer text-status-danger focus:bg-status-danger-soft focus:text-status-danger"
              >
                <Trash2 className="mr-2 h-4 w-4" /> Delete model
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="mt-4 flex items-center gap-4 border-t border-line-soft pt-3 text-xs text-subtle-copy">
          <span className="flex items-center gap-1.5">
            <Images className="h-3.5 w-3.5" /> {posts.length} posts
          </span>
          <span className="flex items-center gap-1.5">
            <UserRound className="h-3.5 w-3.5" /> {avatars.length} avatars
          </span>
          <span className="ml-auto tabular-nums">{model.usernames?.length ?? 0} usernames</span>
        </div>
        {error && <p className="mt-2 text-xs text-status-danger">Could not load content.</p>}
      </div>
    </article>
  )
}

export function ListsList({ lists, loading, onOpenContent, onEdit, onDelete }: ListsListProps) {
  if (loading && lists.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4" /> Loading models...
      </div>
    )
  }

  if (lists.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line-soft bg-panel-subtle p-12 text-center">
        <UserRound className="mb-4 h-10 w-10 text-subtle-copy" />
        <h3 className="text-lg font-medium text-ink">No models</h3>
        <p className="mt-1 text-sm text-subtle-copy">
          Create a model to group its profiles and content.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {lists.map((model) => (
        <ModelCard
          key={model.id}
          model={model}
          onOpenContent={onOpenContent}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}
