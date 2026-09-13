import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { AlertTriangle } from 'lucide-react'
import { getActivityById } from '@/features/workflows/activities/index'
import { ActivityIcon } from './activityIcons'
import { NodeActionToolbar } from './NodeActionToolbar'
import { QuickAddMenu } from './QuickAddMenu'
import { cn } from '@/lib/utils'

interface ActivityNodeData {
  activityId: string
  label: string
  config: Record<string, unknown>
}

function OutputRow({
  nodeId,
  output,
  single,
}: {
  nodeId: string
  output: string
  single: boolean
}) {
  return (
    <div className="group/output relative flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-[var(--panel-subtle)]">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--subtle-copy)]" />
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--muted-copy)] capitalize group-hover/output:text-[var(--ink)]">
        {single ? 'Next' : output.replace(/_/g, ' ')}
      </span>
      <QuickAddMenu
        insertionContext={{ sourceNodeId: nodeId, sourceHandle: single ? null : output }}
        className="h-[22px] w-[22px] opacity-40 group-hover/output:opacity-100 hover:!opacity-100 focus-visible:opacity-100"
        iconClassName="h-3 w-3"
        compact
      />
      <Handle
        type="source"
        position={Position.Right}
        id={single ? undefined : output}
        className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-[var(--panel)] !bg-[var(--workflow-edge)] hover:!bg-[var(--ink)]"
        style={{ right: -7, top: '50%', transform: 'translateY(-50%)' }}
        title={single ? 'Drag to connect next step' : `Drag to connect "${output}" path`}
      />
    </div>
  )
}

function ActivityNodeComponent({ id, data, selected }: NodeProps<ActivityNodeData>) {
  const activity = getActivityById(data.activityId)
  const outputs = activity?.outputs ?? []
  const config = (data.config as Record<string, unknown>) ?? {}
  const missingRequired = (activity?.inputs ?? []).some((input) => {
    if (!input.required) return false
    const value = config[input.name]
    return (
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    )
  })
  const single = outputs.length <= 1
  const defaultInsertionContext = single
    ? { sourceNodeId: id, sourceHandle: null }
    : null

  return (
    <div
      className={cn(
        'group workflow-node relative w-[248px] overflow-visible rounded-xl border bg-[var(--panel)]',
        selected ? 'workflow-node-selected border-[var(--line-strong)]' : 'border-[var(--line)]',
      )}
    >
      <NodeActionToolbar
        nodeId={id}
        selected={selected}
        defaultInsertionContext={defaultInsertionContext}
      />

      <Handle
        type="target"
        position={Position.Left}
        className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-[var(--panel)] !bg-[var(--workflow-edge)] hover:!bg-[var(--ink)]"
        style={{ left: -7, top: 32 }}
        title="Drop a connection here"
      />

      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className="border-line-soft bg-panel-subtle flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border">
          <ActivityIcon
            iconName={activity?.icon ?? ''}
            className="text-ink h-4 w-4"
            strokeWidth={2}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] leading-tight font-semibold text-[var(--ink)]">
            {data.label || activity?.name || 'Unknown'}
          </div>
          {activity && (
            <div className="mt-0.5 truncate text-[11px] leading-none text-[var(--subtle-copy)]">
              {activity.category === 'control' ? 'Control flow' : activity.category}
            </div>
          )}
        </div>
        {missingRequired && (
          <span title="Missing required settings">
            <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--status-warning)]" />
          </span>
        )}
      </div>

      <div className="border-t border-[var(--line-soft)] p-1.5">
        {single ? (
          <OutputRow nodeId={id} output="next" single />
        ) : (
          outputs.map((output) => (
            <OutputRow key={output} nodeId={id} output={output} single={false} />
          ))
        )}
      </div>
    </div>
  )
}

export const ActivityNode = memo(ActivityNodeComponent)
