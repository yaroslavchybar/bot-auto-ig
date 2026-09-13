import type { ButtonHTMLAttributes } from 'react'
import { Copy, Settings2, Trash2 } from 'lucide-react'
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
  title,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { title: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-full text-[var(--subtle-copy)] hover:bg-[var(--panel-hover)] hover:text-[var(--ink)]',
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
}: NodeActionToolbarProps) {
  const { deleteNode, duplicateNode, focusNode } = useWorkflowEditor()

  return (
    <div
      className={cn(
        'pointer-events-none absolute -top-9 left-1/2 z-20 -translate-x-1/2',
        selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
      )}
    >
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-[var(--line)] bg-[var(--panel)] p-0.5 shadow-md">
        <ToolbarButton title="Open settings" onClick={() => focusNode(nodeId)}>
          <Settings2 className="h-3.5 w-3.5" />
        </ToolbarButton>
        {canDuplicate && (
          <ToolbarButton title="Duplicate block" onClick={() => duplicateNode(nodeId)}>
            <Copy className="h-3.5 w-3.5" />
          </ToolbarButton>
        )}
        {canDelete && (
          <ToolbarButton
            title="Delete block"
            onClick={() => deleteNode(nodeId)}
            className="hover:!bg-[var(--status-danger-soft)] hover:!text-[var(--status-danger)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </ToolbarButton>
        )}
      </div>
    </div>
  )
}
