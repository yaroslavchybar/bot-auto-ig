import { useCallback, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  getAllCategories,
  getCategoryLabel,
  searchActivities,
  type ActivityCategoryFilter,
} from '@/features/workflows/activities'
import { ActivityIcon } from './activityIcons'
import { useWorkflowEditor } from './WorkflowEditorContext'
import type { BlockInsertionContext } from './workflowEditorUtils'
import { cn } from '@/lib/utils'

interface BlockLibraryDialogProps {
  open: boolean
  insertionContext: BlockInsertionContext | null
  onOpenChange: (open: boolean) => void
}

export function BlockLibraryDialog({
  open,
  insertionContext,
  onOpenChange,
}: BlockLibraryDialogProps) {
  const { insertActivity } = useWorkflowEditor()
  const [query, setQuery] = useState('')
  const [selectedCategory, setSelectedCategory] =
    useState<ActivityCategoryFilter>('all')

  const categories = useMemo(() => ['all', ...getAllCategories()] as const, [])
  const results = useMemo(
    () => searchActivities(query, selectedCategory),
    [query, selectedCategory],
  )

  const isDisconnected = insertionContext?.disconnected ?? false
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setQuery('')
        setSelectedCategory('all')
      }
      onOpenChange(nextOpen)
    },
    [onOpenChange],
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="border-line bg-panel text-ink flex h-[72vh] w-[min(820px,90vw)] max-w-none flex-col gap-0 overflow-hidden rounded-2xl p-0"
        hideClose
      >
        <DialogHeader className="border-line-soft border-b px-5 py-4">
          <DialogTitle className="text-lg">
            {isDisconnected ? 'Add Block' : 'Insert Block'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isDisconnected
              ? 'Choose a workflow block to place on the canvas.'
              : 'Choose the next block for this connection.'}
          </DialogDescription>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search blocks by name, description, or keyword"
            className="mt-3 h-10"
            autoFocus
          />
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          <div className="border-line-soft bg-panel-subtle flex w-44 shrink-0 flex-col border-r p-2.5">
            {categories.map((category) => {
              const active = selectedCategory === category
              const label =
                category === 'all' ? 'All' : getCategoryLabel(category)

              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setSelectedCategory(category)}
                  className={cn(
                    'text-copy hover:bg-panel-hover flex items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
                    active && 'bg-panel text-ink border-line border shadow-xs',
                  )}
                >
                  <span>{label}</span>
                  <span className="text-subtle-copy text-[11px]">
                    {searchActivities(query, category).length}
                  </span>
                </button>
              )
            })}
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 p-3">
              {results.length === 0 ? (
                <div className="text-subtle-copy rounded-xl border border-dashed p-8 text-center text-sm">
                  No blocks match this search.
                </div>
              ) : (
                results.map((activity) => {
                  return (
                    <button
                      key={activity.id}
                      type="button"
                      className="border-line hover:border-line-strong hover:bg-panel-subtle flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors"
                      onClick={() => {
                        if (!insertionContext) return
                        insertActivity(activity.id, insertionContext)
                        onOpenChange(false)
                      }}
                    >
                      <div
                        className="rounded-lg p-2"
                        style={{ backgroundColor: `${activity.color}18` }}
                      >
                        <ActivityIcon
                          iconName={activity.icon}
                          className="h-4 w-4"
                          style={{ color: activity.color }}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-ink text-[15px] font-semibold">
                            {activity.name}
                          </span>
                          <span className="text-subtle-copy text-[10px] font-semibold tracking-[0.18em] uppercase">
                            {getCategoryLabel(activity.category)}
                          </span>
                        </div>
                        <p className="text-muted-copy mt-1 text-[13px] leading-relaxed">
                          {activity.description}
                        </p>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}
