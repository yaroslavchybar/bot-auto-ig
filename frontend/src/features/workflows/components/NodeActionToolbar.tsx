import type { ButtonHTMLAttributes } from 'react'
import {
  Copy,
  MoreHorizontal,
  Settings2,
  Trash2,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useWorkflowEditor } from './WorkflowEditorContext'
import type { BlockInsertionContext } from './workflowEditorUtils'
import { cn } from '@/lib/utils'

interface NodeActionToolbarProps {
  nodeId: string
  selected: boolean
  canDuplicate?: boolean
  canDelete?: boolean
  defaultInsertionContext?: BlockInsertionContext | null
}

function ToolbarButton({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'border-line bg-panel text-subtle-copy hover:bg-panel-hover hover:text-ink inline-flex h-6.5 w-6.5 items-center justify-center rounded-[10px] border shadow-sm transition-colors',
        className,
      )}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      {...props}
    >
      {children}
    </button>
  )
}

export function NodeActionToolbar({
  nodeId,
  selected,
  canDuplicate = true,
  canDelete = true,
  defaultInsertionContext = null,
}: NodeActionToolbarProps) {
  const { deleteNode, duplicateNode, focusNode, openBlockLibrary } =
    useWorkflowEditor()

  return (
    <div
      className={cn(
        'pointer-events-none absolute top-[-13px] right-[-1px] z-20 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100',
        selected && 'opacity-100',
      )}
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-[15px] bg-[rgb(51,51,62)]/96 p-1 text-white shadow-lg ring-1 ring-black/15 backdrop-blur-sm">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <ToolbarButton className="border-transparent bg-transparent text-white/78 hover:bg-white/10 hover:text-white">
              <MoreHorizontal className="h-3 w-3" />
            </ToolbarButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => focusNode(nodeId)}>
              <Settings2 className="h-4 w-4" />
              Open Settings
            </DropdownMenuItem>
            {defaultInsertionContext ? (
              <DropdownMenuItem
                onSelect={() => {
                  window.setTimeout(
                    () => openBlockLibrary(defaultInsertionContext),
                    0,
                  )
                }}
              >
                <MoreHorizontal className="h-4 w-4" />
                Browse Blocks
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

        {canDuplicate ? (
          <ToolbarButton
            className="border-transparent bg-transparent text-white/78 hover:bg-white/10 hover:text-white"
            onClick={() => duplicateNode(nodeId)}
          >
            <Copy className="h-3 w-3" />
          </ToolbarButton>
        ) : null}

        {canDelete ? (
          <ToolbarButton
            className="border-transparent bg-transparent text-white/78 hover:bg-white/10 hover:text-white"
            onClick={() => deleteNode(nodeId)}
          >
            <Trash2 className="h-3 w-3" />
          </ToolbarButton>
        ) : null}
      </div>
    </div>
  )
}
