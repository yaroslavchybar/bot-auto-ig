import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { AlertTriangle, Play } from 'lucide-react'
import { NodeActionToolbar } from './NodeActionToolbar'
import { QuickAddMenu } from './QuickAddMenu'
import { cn } from '@/lib/utils'

export type StartNodeData = {
  config?: Record<string, unknown>
}

export {
  START_NODE_INPUTS,
  getDefaultStartConfig,
  normalizeStartConfig,
} from '../startNode'
import { getDefaultStartConfig } from '../startNode'

function StartNodeComponent({ id, data, selected }: NodeProps<StartNodeData>) {
  const sourceLists = (data?.config as Record<string, unknown> | undefined)
    ?.sourceLists
  const missingRequired =
    !Array.isArray(sourceLists) || sourceLists.length === 0
  return (
    <div
      className={cn(
        'group automation-node relative w-[248px] overflow-visible rounded-xl border bg-[var(--panel)]',
        selected ? 'automation-node-selected border-[var(--line-strong)]' : 'border-[var(--line)]',
      )}
    >
      <NodeActionToolbar
        nodeId={id}
        selected={selected}
        canDelete={false}
        canDuplicate={false}
        defaultInsertionContext={{ sourceNodeId: id, sourceHandle: null }}
      />

      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className="border-line-soft bg-panel-subtle flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border">
          <Play className="text-ink h-4 w-4" fill="currentColor" strokeWidth={0} />
        </div>
        <div className="truncate text-[13px] font-semibold text-[var(--ink)]">
          Start
        </div>
        {missingRequired && (
          <span title="Select at least one source list">
            <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--status-warning)]" />
          </span>
        )}
      </div>

      <div className="border-t border-[var(--line-soft)] p-1.5">
        <div className="group/output relative flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-[var(--panel-subtle)]">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--subtle-copy)]" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--muted-copy)] group-hover/output:text-[var(--ink)]">
            Next
          </span>
          <QuickAddMenu
            insertionContext={{ sourceNodeId: id, sourceHandle: null }}
            className="h-[22px] w-[22px] opacity-60 group-hover/output:opacity-100 hover:!opacity-100"
            iconClassName="h-3 w-3"
            compact
          />
          <Handle
            type="source"
            position={Position.Right}
            className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-[var(--panel)] !bg-[var(--automation-edge)] hover:!bg-[var(--ink)]"
            style={{ right: -7, top: '50%', transform: 'translateY(-50%)' }}
            title="Drag to connect the first step"
          />
        </div>
      </div>
    </div>
  )
}

export const StartNode = memo(StartNodeComponent)

export function createDefaultStartData(): StartNodeData {
  return { config: getDefaultStartConfig() }
}

export const DEFAULT_START_DATA: StartNodeData = {}
