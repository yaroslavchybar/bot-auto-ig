import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { getActivityById } from '@/lib/activities/index'
import {
  Scroll,
  Film,
  UserPlus,
  UserMinus,
  UserCheck,
  MessageCircle,
  Inbox,
  CircleDot,
  Clock,
  GitBranch,
  Repeat,
  GitFork,
  HelpCircle,
} from 'lucide-react'

const iconMap: Record<string, React.ElementType> = {
  Scroll,
  Film,
  UserPlus,
  UserMinus,
  UserCheck,
  MessageCircle,
  Inbox,
  CircleDot,
  Clock,
  GitBranch,
  Repeat,
  GitFork,
}

interface ActivityNodeData {
  activityId: string
  label: string
  config: Record<string, unknown>
}

function ActivityNodeComponent({
  data,
  selected,
}: NodeProps<ActivityNodeData>) {
  const activity = getActivityById(data.activityId)

  const Icon = activity ? iconMap[activity.icon] || HelpCircle : HelpCircle
  const color = activity?.color || 'var(--workflow-edge)'

  return (
    <div
      className={`bg-panel workflow-node relative flex min-w-[180px] flex-col overflow-visible rounded-[3px] border ${selected ? 'workflow-node-selected border-line-strong' : 'border-line'} `}
    >
      <div className="relative flex h-full w-full">
        {/* Left colored border strip */}
        <div
          className="absolute top-0 bottom-0 left-0 w-1 shrink-0 rounded-l-[3px]"
          style={{ backgroundColor: color }}
        />

        <div className="flex w-full flex-col pl-1">
          {/* Input handle */}
          <Handle
            type="target"
            position={Position.Left}
            className="workflow-handle !h-2.5 !w-2.5 !rounded-full !border-0"
            style={{ left: -5 }}
          />

          {/* Header */}
          <div className="border-line-soft bg-panel-subtle flex items-center gap-2 border-b p-2 pb-1.5">
            <div
              className="border-line flex h-5 w-5 shrink-0 items-center justify-center rounded-[2px] border"
              style={{ backgroundColor: `${color}18` }}
            >
              <Icon className="h-3 w-3" style={{ color }} strokeWidth={2} />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-ink text-[10px] leading-none font-bold tracking-wider uppercase">
                {data.label || activity?.name || 'Unknown'}
              </span>
              {activity && (
                <span className="text-subtle-copy font-mono text-[9px] leading-none tracking-widest uppercase">
                  {activity.category}
                </span>
              )}
            </div>
          </div>

          {/* Standard single output handle (if no multiple outputs defined) */}
          {activity && activity.outputs.length === 1 && (
            <Handle
              type="source"
              position={Position.Right}
              className="workflow-handle !h-2.5 !w-2.5 !rounded-full !border-0"
              style={{ right: -5 }}
            />
          )}

          {/* Multiple Output handles with labels */}
          {activity && activity.outputs.length > 1 && (
            <div className="flex flex-col bg-transparent">
              {activity.outputs.map((output) => (
                <div
                  key={output}
                  className="border-line-soft relative flex items-center justify-end border-b px-2 py-1 last:border-b-0"
                >
                  <span className="text-subtle-copy mr-2 font-mono text-[9px] tracking-widest uppercase">
                    {output}
                  </span>
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={output}
                    className="workflow-handle !absolute !top-1/2 !right-[-5px] !h-2.5 !w-2.5 !translate-x-0 !-translate-y-1/2 !rounded-full !border-0"
                  />
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
