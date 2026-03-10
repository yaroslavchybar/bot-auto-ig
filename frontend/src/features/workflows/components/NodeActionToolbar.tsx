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
        'text-subtle-copy hover:bg-white/10 hover:text-white inline-flex h-4 w-5 items-center justify-center transition-colors',
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
        'pointer-events-none absolute top-[-10px] right-1 z-20 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100',
        selected && 'opacity-100',
      )}
    >
      <div className="pointer-events-auto flex h-4 items-center overflow-hidden rounded-full bg-[#2B2D31] text-white shadow-sm border border-[#1E1F22]">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <ToolbarButton className="border-r border-white/10 text-[#B5BAC1]">
              <MoreHorizontal className="h-2.5 w-2.5" />
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
            className="border-r border-white/10 text-[#B5BAC1]"
            onClick={() => duplicateNode(nodeId)}
          >
            <Copy className="h-2 w-2" />
          </ToolbarButton>
        ) : null}

        {canDelete ? (
          <ToolbarButton
            className="text-[#B5BAC1]"
            onClick={() => deleteNode(nodeId)}
          >
            <Trash2 className="h-2 w-2" />
          </ToolbarButton>
        ) : null}
      </div>
    </div>
  )
}
