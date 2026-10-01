import { MessageSquare, Search, X } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { ChatThread } from '../types'
import { formatTimeAgo, initials, threadPreview, threadTime } from '../utils/chat'

type ThreadListProps = {
  threads: ChatThread[]
  totalCount: number
  selectedThreadId: string
  loading: boolean
  disabled: boolean
  emptyDescription?: string
  searchQuery: string
  onSearchChange: (value: string) => void
  onSelect: (id: string) => void
  now: number
  tagFilter: string
  availableTags: string[]
  tagsLoading: boolean
  onTagFilterChange: (tag: string) => void
}

export function ThreadList({
  threads,
  totalCount,
  selectedThreadId,
  loading,
  disabled,
  emptyDescription,
  searchQuery,
  onSearchChange,
  onSelect,
  now,
  tagFilter,
  availableTags,
  tagsLoading,
  onTagFilterChange,
}: ThreadListProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line-soft p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-copy" />
          <Input
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search conversations..."
            aria-label="Search conversations"
            disabled={disabled}
            className="h-8 rounded-lg brand-focus bg-field pr-8 pl-9 text-sm shadow-xs"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-subtle-copy hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Select
          value={tagFilter ? `tag:${tagFilter}` : 'all'}
          onValueChange={(value) => onTagFilterChange(value === 'all' ? '' : value.slice(4))}
          disabled={tagsLoading}
        >
          <SelectTrigger
            aria-label="Filter conversations by tag"
            className="mt-2 h-8 w-full bg-field text-sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tags</SelectItem>
            {[...new Set([...availableTags, ...(tagFilter ? [tagFilter] : [])])]
              .sort()
              .map((tag) => (
                <SelectItem key={tag} value={`tag:${tag}`}>
                  {tag}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2" role="listbox" aria-label="Conversations">
        {loading && threads.length === 0 && <ThreadSkeletons />}
        {!loading && disabled && (
          <ThreadEmpty
            title="Chat is disconnected"
            description="Connect a profile to load conversations."
          />
        )}
        {!loading && !disabled && threads.length === 0 && totalCount === 0 && (
          <ThreadEmpty
            title="No conversations"
            description={emptyDescription ?? 'No DM threads found in this inbox.'}
          />
        )}
        {!loading && !disabled && threads.length === 0 && totalCount > 0 && (
          <ThreadEmpty
            title="No matches"
            description="Try a different search term or clear the filter."
          />
        )}
        {threads.map((thread) => {
          const key = thread.profileId ? `${thread.profileId}:${thread.id}` : thread.id
          const active = key === selectedThreadId
          const time = threadTime(thread)
          return (
            <button
              key={key}
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => onSelect(key)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left',
                active ? 'bg-panel-selected' : 'hover:bg-panel-subtle',
              )}
            >
              <Avatar className="size-8 shrink-0 border brand-avatar">
                <AvatarFallback className="bg-panel-strong text-[11px] font-semibold text-copy">
                  {initials(thread.title)}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      'truncate text-[13px]',
                      thread.unread ? 'font-semibold' : 'font-medium',
                    )}
                  >
                    {thread.title}
                  </span>
                  {time > 0 && (
                    <span
                      className={cn(
                        'shrink-0 text-[11px]',
                        thread.unread ? 'text-copy font-medium' : 'text-subtle-copy',
                      )}
                    >
                      {formatTimeAgo(time, now)}
                    </span>
                  )}
                </span>
                <span className="mt-px flex items-center gap-1.5">
                  <span className="block min-w-0 flex-1 truncate text-xs text-muted-copy">
                    {threadPreview(thread)}
                    {thread.profileName && (
                      <span className="text-subtle-copy"> · via {thread.profileName}</span>
                    )}
                  </span>
                  {thread.unread && (
                    <span
                      className="size-2 shrink-0 rounded-full status-dot-success"
                      aria-label="Unread"
                      role="img"
                    />
                  )}
                </span>
                {Boolean(thread.tags?.length) && (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {thread.tags?.map((tag) => (
                      <span
                        key={tag}
                        className="max-w-full truncate rounded-full bg-panel-subtle px-1.5 py-0.5 text-[10px] text-muted-copy"
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ThreadSkeletons() {
  return (
    <div className="space-y-1" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <div className="size-8 shrink-0 rounded-full bg-panel-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-2/3 rounded bg-panel-muted" />
            <div className="h-2.5 w-full rounded bg-panel-muted" />
          </div>
        </div>
      ))}
    </div>
  )
}

function ThreadEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <MessageSquare className="size-6 text-subtle-copy" />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-copy">{description}</p>
    </div>
  )
}
