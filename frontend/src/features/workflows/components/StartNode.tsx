import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { Play } from 'lucide-react'
import { NodeActionToolbar } from './NodeActionToolbar'
import { QuickAddMenu } from './QuickAddMenu'

export type StartNodeData = Record<string, never>

function StartNodeComponent({ id, selected }: NodeProps<StartNodeData>) {
  return (
    <div
      className={`group bg-panel workflow-node relative flex min-w-[100px] max-w-[180px] flex-col overflow-visible rounded-[6px] border w-full ${selected ? 'workflow-node-selected border-line-strong' : 'border-line'} `}
    >
      <NodeActionToolbar
        nodeId={id}
        selected={selected}
        canDelete={false}
        canDuplicate={false}
        defaultInsertionContext={{ sourceNodeId: id, sourceHandle: null }}
      />

      <div className="relative flex h-full w-full">
        <div className="status-dot-success absolute top-0 bottom-0 left-0 w-1 shrink-0 rounded-l-[6px]" />

        <div className="flex w-full flex-col pl-1">
          <div className="border-line-soft bg-panel-subtle flex items-center gap-1 border-b px-1 py-1 pr-12">
            <div className="bg-status-success-soft border-status-success-border flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[2px] border">
              <Play
                className="text-status-success h-2 w-2"
                fill="none"
                strokeWidth={2}
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-ink text-[10px] leading-none font-bold tracking-wider uppercase">
                Start
              </span>
              <span className="text-subtle-copy font-mono text-[8px] leading-none tracking-[0.22em] uppercase">
                Workflow Entry
              </span>
            </div>
          </div>

          <div className="group/output border-line-soft text-subtle-copy flex min-h-[16px] items-center justify-between bg-transparent px-1.5 py-0.5 font-mono text-[9px] tracking-[0.22em] uppercase">
            <span className="truncate">Entry Point</span>
            <div className="relative flex items-center justify-end pr-2">
              <QuickAddMenu
                insertionContext={{ sourceNodeId: id, sourceHandle: null }}
                className="absolute top-1/2 right-[-11px] z-10 -translate-y-1/2 opacity-0 pointer-events-none group-hover/output:opacity-100 group-hover/output:pointer-events-auto group-focus-within/output:opacity-100 group-focus-within/output:pointer-events-auto"
                compact
              />
              <Handle
                type="source"
                position={Position.Right}
                className="workflow-handle !absolute !top-1/2 !right-[-5px] !h-2.5 !w-2.5 !translate-x-0 !-translate-y-1/2 !rounded-full !border-0"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const StartNode = memo(StartNodeComponent)

export const DEFAULT_START_DATA: StartNodeData = {}


