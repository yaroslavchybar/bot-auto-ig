import {
  ArrowRight,
  Plus,
  Search,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  getActivityById,
  getQuickPickActivities,
  searchActivities,
} from '@/features/workflows/activities'
import { ActivityIcon } from './activityIcons'
import { useWorkflowEditor } from './WorkflowEditorContext'
import type { BlockInsertionContext } from './workflowEditorUtils'
import { cn } from '@/lib/utils'
import { getRecentActivityIds } from '../utils/recentActivities'

interface QuickAddMenuProps {
  insertionContext: BlockInsertionContext
  className?: string
  compact?: boolean
  iconClassName?: string
}

export function QuickAddMenu({
  insertionContext,
  className,
  compact,
  iconClassName,
}: QuickAddMenuProps) {
  const { insertActivity, openBlockLibrary, setQuickAddMenuOpen } =
    useWorkflowEditor()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const quickPickActivities = useMemo(() => getQuickPickActivities(), [])
  const recentActivities = useMemo(() => {
    if (!open) {
      return []
    }

    return getRecentActivityIds()
      .map((activityId) => getActivityById(activityId))
      .filter((activity) => activity !== undefined)
  }, [open])
  const filteredActivities = useMemo(() => {
    if (!query.trim()) {
      return []
    }

    return searchActivities(query).slice(0, 8)
  }, [query])
  const recentActivityIds = useMemo(
    () => new Set(recentActivities.map((activity) => activity.id)),
    [recentActivities],
  )
  const suggestedActivities = useMemo(
    () =>
      quickPickActivities.filter((activity) => !recentActivityIds.has(activity.id)),
    [quickPickActivities, recentActivityIds],
  )

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    setQuickAddMenuOpen(nextOpen)

    if (!nextOpen) {
      setQuery('')
    }
  }

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'border-line bg-panel/96 text-ink hover:bg-panel-hover inline-flex items-center justify-center rounded-full border shadow-md backdrop-blur-sm transition-[opacity,background-color,color,transform]',
            compact ? 'h-6 w-6' : 'h-8 w-8',
            className,
          )}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          aria-label="Add connected block"
        >
          <Plus
            className={cn(compact ? 'h-3 w-3' : 'h-4 w-4', iconClassName)}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right" className="w-80 p-2">
        <DropdownMenuLabel>Quick Add</DropdownMenuLabel>
        <div className="px-2 pb-2">
          <div className="relative">
            <Search className="text-subtle-copy pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search blocks"
              className="h-9 pl-9"
              onKeyDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            />
          </div>
        </div>
        {query.trim() ? (
          filteredActivities.length === 0 ? (
            <div className="text-subtle-copy px-2 py-3 text-sm">
              No blocks match this search.
            </div>
          ) : (
            filteredActivities.map((activity) => {
              return (
                <DropdownMenuItem
                  key={activity.id}
                  onSelect={() => insertActivity(activity.id, insertionContext)}
                  className="items-start gap-3"
                >
                  <div
                    className="mt-0.5 rounded-md p-1.5"
                    style={{ backgroundColor: `${activity.color}16` }}
                  >
                    <ActivityIcon
                      iconName={activity.icon}
                      className="h-3.5 w-3.5"
                      style={{ color: activity.color }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-ink text-sm font-medium">{activity.name}</div>
                    <div className="text-subtle-copy line-clamp-1 text-xs">
                      {activity.description}
                    </div>
                  </div>
                </DropdownMenuItem>
              )
            })
          )
        ) : (
          <>
            {recentActivities.length > 0 ? (
              <>
                <DropdownMenuLabel className="pt-0">Recent</DropdownMenuLabel>
                {recentActivities.map((activity) => {
                  return (
                    <DropdownMenuItem
                      key={activity.id}
                      onSelect={() => insertActivity(activity.id, insertionContext)}
                      className="items-start gap-3"
                    >
                      <div
                        className="mt-0.5 rounded-md p-1.5"
                        style={{ backgroundColor: `${activity.color}16` }}
                      >
                        <ActivityIcon
                          iconName={activity.icon}
                          className="h-3.5 w-3.5"
                          style={{ color: activity.color }}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-ink text-sm font-medium">{activity.name}</div>
                        <div className="text-subtle-copy line-clamp-1 text-xs">
                          {activity.description}
                        </div>
                      </div>
                      <span className="text-subtle-copy ml-auto text-[10px] font-semibold tracking-[0.18em] uppercase">
                        Recent
                      </span>
                    </DropdownMenuItem>
                  )
                })}
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuLabel className="pt-0">Suggested</DropdownMenuLabel>
            {suggestedActivities.map((activity) => {
              return (
                <DropdownMenuItem
                  key={activity.id}
                  onSelect={() => insertActivity(activity.id, insertionContext)}
                  className="items-start gap-3"
                >
                  <div
                    className="mt-0.5 rounded-md p-1.5"
                    style={{ backgroundColor: `${activity.color}16` }}
                  >
                    <ActivityIcon
                      iconName={activity.icon}
                      className="h-3.5 w-3.5"
                      style={{ color: activity.color }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-ink text-sm font-medium">{activity.name}</div>
                    <div className="text-subtle-copy line-clamp-1 text-xs">
                      {activity.description}
                    </div>
                  </div>
                </DropdownMenuItem>
              )
            })}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault()
            window.setTimeout(() => openBlockLibrary(insertionContext), 0)
          }}
        >
          <ArrowRight className="h-4 w-4" />
          More
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
