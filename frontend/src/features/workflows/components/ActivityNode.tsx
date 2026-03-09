import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { getActivityById } from '@/features/workflows/activities/index'
import { ActivityIcon } from './activityIcons'
import { NodeActionToolbar } from './NodeActionToolbar'
import { QuickAddMenu } from './QuickAddMenu'

interface ActivityNodeData {
  activityId: string
  label: string
  config: Record<string, unknown>
}

function ActivityNodeComponent({
  id,
  data,
  selected,
}: NodeProps<ActivityNodeData>) {
  const activity = getActivityById(data.activityId)
  const outputs = activity?.outputs ?? []
  const color = activity?.color || 'var(--workflow-edge)'
  const defaultInsertionContext =
    outputs.length <= 1 ? { sourceNodeId: id, sourceHandle: null } : null

  return (
    <div
      className={`group bg-panel workflow-node relative flex min-w-[174px] flex-col overflow-visible rounded-[3px] border ${selected ? 'workflow-node-selected border-line-strong' : 'border-line'} `}
    >
      <NodeActionToolbar
        nodeId={id}
        selected={selected}
        defaultInsertionContext={defaultInsertionContext}
      />

      <Handle
        type="target"
        position={Position.Left}
        className="workflow-handle !h-2.5 !w-2.5 !rounded-full !border-0"
        style={{ left: -5 }}
      />

      <div className="relative flex h-full w-full">
        <div
          className="absolute top-0 bottom-0 left-0 w-1 shrink-0 rounded-l-[3px]"
          style={{ backgroundColor: color }}
        />

        <div className="flex w-full flex-col pl-1">
          <div className="border-line-soft bg-panel-subtle flex items-center gap-2 border-b px-2 py-1.5 pr-24">
            <div
              className="border-line flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-[2px] border"
              style={{ backgroundColor: `${color}18` }}
            >
              <ActivityIcon
                iconName={activity?.icon ?? ''}
                className="h-2.5 w-2.5"
                style={{ color }}
                strokeWidth={2}
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-ink text-[9.5px] leading-none font-bold tracking-wider uppercase">
                {data.label || activity?.name || 'Unknown'}
              </span>
              {activity && (
                <span className="text-subtle-copy font-mono text-[8px] leading-none tracking-[0.22em] uppercase">
                  {activity.category}
                </span>
              )}
            </div>
          </div>

          {outputs.length <= 1 ? (
            <div className="group/output border-line-soft relative flex min-h-[24px] items-center justify-between border-t px-2 py-1">
              <span className="text-subtle-copy font-mono text-[8px] tracking-[0.22em] uppercase">
                Next
              </span>
              <QuickAddMenu
                insertionContext={{ sourceNodeId: id, sourceHandle: null }}
                className="absolute top-1/2 right-[-11px] z-10 -translate-y-1/2 opacity-0 pointer-events-none group-hover/output:opacity-100 group-hover/output:pointer-events-auto group-focus-within/output:opacity-100 group-focus-within/output:pointer-events-auto"
                compact
              />
              <Handle
                type="source"
                position={Position.Right}
                className="workflow-handle !h-2.5 !w-2.5 !rounded-full !border-0"
                style={{ right: -5, top: '50%', transform: 'translateY(-50%)' }}
              />
            </div>
          ) : (
            <div className="flex flex-col bg-transparent">
              {outputs.map((output) => (
                <div
                  key={output}
                  className="group/output border-line-soft relative flex items-center justify-between border-b px-2 py-1 last:border-b-0"
                >
                  <span className="text-subtle-copy font-mono text-[8px] tracking-[0.22em] uppercase">
                    {output}
                  </span>
                  <div className="relative flex items-center justify-end pr-5">
                    <QuickAddMenu
                      insertionContext={{ sourceNodeId: id, sourceHandle: output }}
                      className="absolute top-1/2 right-[-11px] z-10 -translate-y-1/2 opacity-0 pointer-events-none group-hover/output:opacity-100 group-hover/output:pointer-events-auto group-focus-within/output:opacity-100 group-focus-within/output:pointer-events-auto"
                      compact
                    />
                    <Handle
                      type="source"
                      position={Position.Right}
                      id={output}
                      className="workflow-handle !absolute !top-1/2 !right-[-5px] !h-2.5 !w-2.5 !translate-x-0 !-translate-y-1/2 !rounded-full !border-0"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export const ActivityNode = memo(ActivityNodeComponent)


