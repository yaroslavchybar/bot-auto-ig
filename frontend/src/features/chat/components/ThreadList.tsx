import { Button } from '@/components/ui/button'
import { Archive, ArchiveRestore, MessageSquare, Search, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import type { ChatFolder, ChatThread } from '../types'
import { formatTimeAgo, threadPreview, threadTime } from '../utils/chat'
import { ChatAvatar } from './ChatAvatar'

type ThreadListProps = {
  threads: ChatThread[]
  profileId?: string
  viewerId?: string
  totalCount: number
  selectedThreadId: string
  loading: boolean
  disabled: boolean
  emptyDescription?: string
  searchQuery: string
  onSearchChange: (value: string) => void
  onSelect: (id: string) => void
  now: number
  folder: ChatFolder
  onFolderChange: (folder: ChatFolder) => void
  archiveDisabled: boolean
  onArchiveChange: (key: string, archived: boolean) => Promise<void>
  filters?: ReactNode
  listFiltered?: boolean
}

export function ThreadList({
  threads,
  profileId = '',
  viewerId = '',
  totalCount,
  selectedThreadId,
  loading,
  disabled,
  emptyDescription,
  searchQuery,
  onSearchChange,
  onSelect,
  now,
  folder,
  onFolderChange,
  archiveDisabled,
  onArchiveChange,
  filters,
  listFiltered = false,
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
            <Button
              variant="ghost"
              size="icon"
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded text-subtle-copy hover:text-ink"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Conversation folder" className="flex shrink-0 gap-2">
            {(
              [
                ['inbox', 'Inbox'],
                ['archived', 'Archived'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={folder === value}
                onClick={() => onFolderChange(value)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2',
                  folder === value
                    ? 'brand-button'
                    : 'bg-panel-subtle text-muted-copy hover:bg-panel-muted hover:text-ink',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {filters}
        </div>
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
            title={
              listFiltered
                ? 'No matching chats'
                : folder === 'archived'
                  ? 'No archived chats'
                  : 'Inbox is empty'
            }
            description={
              listFiltered
                ? 'Try another scraped list, profile, or conversation folder.'
                : folder === 'archived'
                  ? 'Archived conversations will appear here.'
                  : (emptyDescription ?? 'No DM threads found in this inbox.')
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
          const key = thread.profileId ? `${thread.profileId}:${thread.id}` : thread.id
          const active = key === selectedThreadId
          const time = threadTime(thread)
          return (
            <ContextMenu key={key}>
              <ContextMenuTrigger asChild>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => onSelect(key)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left',
                    active ? 'bg-panel-selected' : 'hover:bg-panel-subtle',
                  )}
                >
                  <ChatAvatar
                    profileId={thread.profileId ?? (profileId === 'all' ? '' : profileId)}
                    viewerId={thread.viewerId ?? viewerId}
                    users={thread.users}
                    title={thread.title}
                  />
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
                  </span>
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent aria-label="Conversation actions">
                <ContextMenuItem
                  disabled={archiveDisabled}
                  onSelect={() => void onArchiveChange(key, !thread.archived)}
                >
                  {thread.archived ? <ArchiveRestore /> : <Archive />}
                  {thread.archived ? 'Move to inbox' : 'Archive chat'}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
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
