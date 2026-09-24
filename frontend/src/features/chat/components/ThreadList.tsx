import { MessageSquare, Search, X } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { ChatThread } from '../types'
import {
  formatTimeAgo,
  initials,
  threadPreview,
  threadTime,
} from '../utils/chat'

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
}: ThreadListProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-line-soft border-b p-3">
        <div className="relative">
          <Search className="text-subtle-copy pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search conversations..."
            aria-label="Search conversations"
            disabled={disabled}
            className="bg-field brand-focus h-8 rounded-lg pr-8 pl-9 text-sm shadow-xs"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
              className="text-subtle-copy hover:text-ink absolute top-1/2 right-2 -translate-y-1/2 rounded p-1"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto p-2"
        role="listbox"
        aria-label="Conversations"
      >
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
            description={
              emptyDescription ?? 'No DM threads found in this inbox.'
            }
          />
        )}
        {!loading && !disabled && threads.length === 0 && totalCount > 0 && (
          <ThreadEmpty
            title="No matches"
            description="Try a different search term or clear the filter."
          />
        )}
        {threads.map((thread) => {
          const key = thread.profileId
            ? `${thread.profileId}:${thread.id}`
            : thread.id
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
                'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
                active ? 'bg-panel-selected' : 'hover:bg-panel-subtle',
              )}
            >
              <Avatar className="brand-avatar size-8 shrink-0 border">
                <AvatarFallback className="bg-panel-strong text-copy text-[11px] font-semibold">
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
                        thread.unread
                          ? 'text-copy font-medium'
                          : 'text-subtle-copy',
                      )}
                    >
                      {formatTimeAgo(time, now)}
                    </span>
                  )}
                </span>
                <span className="mt-px flex items-center gap-1.5">
                  <span className="text-muted-copy block min-w-0 flex-1 truncate text-xs">
                    {threadPreview(thread)}
                    {thread.profileName && (
                      <span className="text-subtle-copy">
                        {' '}
                        · via {thread.profileName}
                      </span>
                    )}
                  </span>
                  {thread.unread && (
                    <span
                      className="status-dot-success size-2 shrink-0 rounded-full"
                      aria-label="Unread"
                      role="img"
                    />
                  )}
                </span>
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
        <div
          key={index}
          className="flex animate-pulse items-center gap-2.5 rounded-lg px-2 py-2"
        >
          <div className="bg-panel-muted size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="bg-panel-muted h-3 w-2/3 rounded" />
            <div className="bg-panel-muted h-2.5 w-full rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

function ThreadEmpty({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <MessageSquare className="text-subtle-copy size-6" />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-muted-copy text-xs">{description}</p>
    </div>
  )
}
