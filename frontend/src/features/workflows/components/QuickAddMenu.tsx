import {
  ArrowRight,
  Plus,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getQuickPickActivities } from '@/features/workflows/activities'
import { ActivityIcon } from './activityIcons'
import { useWorkflowEditor } from './WorkflowEditorContext'
import type { BlockInsertionContext } from './workflowEditorUtils'
import { cn } from '@/lib/utils'

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
  const { insertActivity, openBlockLibrary } = useWorkflowEditor()
  const quickPickActivities = getQuickPickActivities()

  return (
    <DropdownMenu modal={false}>
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
      <DropdownMenuContent align="start" side="right" className="w-64 p-2">
        <DropdownMenuLabel>Quick Add</DropdownMenuLabel>
        {quickPickActivities.map((activity) => {
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
