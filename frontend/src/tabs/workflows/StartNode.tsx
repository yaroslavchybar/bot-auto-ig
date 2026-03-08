import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { Play, Settings } from 'lucide-react'

export type StartNodeData = Record<string, never>

function StartNodeComponent({ selected }: NodeProps<StartNodeData>) {
  return (
    <div
      className={`bg-panel workflow-node flex w-[180px] flex-col overflow-hidden rounded-[3px] border ${selected ? 'workflow-node-selected border-line-strong' : 'border-line'} `}
    >
      <div className="relative flex h-full w-full">
        {/* Left colored border strip */}
        <div className="status-dot-success absolute top-0 bottom-0 left-0 w-1 shrink-0 rounded-l-[3px]" />

        <div className="flex w-full flex-col pl-1">
          {/* Header */}
          <div className="border-line-soft bg-panel-subtle flex items-center gap-2 border-b p-2 pb-1.5">
            <div className="bg-status-success-soft border-status-success-border flex h-5 w-5 shrink-0 items-center justify-center rounded-[2px] border">
              <Play
                className="text-status-success h-3 w-3"
                fill="none"
                strokeWidth={2}
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-ink text-[10px] leading-none font-bold tracking-wider uppercase">
                Start
              </span>
              <span className="text-subtle-copy font-mono text-[9px] leading-none tracking-widest uppercase">
                Workflow Entry
              </span>
            </div>
          </div>

          {/* Settings Overview removed */}
          <div className="border-line-soft text-subtle-copy flex items-center justify-center gap-1.5 border-t bg-transparent py-1.5 font-mono text-[9px] tracking-widest uppercase">
            <Settings className="h-3 w-3" />
            <span>Click to configure</span>
          </div>
        </div>
      </div>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="workflow-handle !h-2.5 !w-2.5 !rounded-full !border-0"
        style={{ right: -5 }}
      />
    </div>
  )
}

export const StartNode = memo(StartNodeComponent)

export const DEFAULT_START_DATA: StartNodeData = {}
