import { useCallback, useState } from 'react'
import type { Node } from 'reactflow'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getActivityById } from '@/features/workflows/activities/index'
import { X, Play, Settings2 } from 'lucide-react'
import { GroupedInputs } from '@/features/workflows/activity-ui/GroupedInputs'

interface NodeSettingsPanelProps {
  selectedNode: Node | null
  onUpdateNode: (nodeId: string, data: Record<string, unknown>) => void
  onClose: () => void
}

export function NodeSettingsPanel({
  selectedNode,
  onUpdateNode,
  onClose,
}: NodeSettingsPanelProps) {
  // Hide panel when no node selected
  if (!selectedNode) {
    return null
  }

  const isStartNode = selectedNode.type === 'start'

  if (isStartNode) {
    return <StartNodeSettings onClose={onClose} />
  }

  return (
    <ActivityNodeSettings
      key={selectedNode.id}
      node={selectedNode}
      onUpdate={onUpdateNode}
      onClose={onClose}
    />
  )
}

// ============================================================================
// Start Node Settings
// ============================================================================

interface StartNodeSettingsProps {
  onClose: () => void
}

function StartNodeSettings({ onClose }: StartNodeSettingsProps) {
  return (
    <div className="border-line bg-panel flex w-[320px] shrink-0 flex-col border-l">
      <div className="border-line-soft bg-panel-subtle flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="bg-status-success-soft border-status-success-border rounded-[2px] border p-1">
            <Play className="text-status-success h-3.5 w-3.5" />
          </div>
          <div className="flex flex-col gap-0.5">
            <h3 className="text-ink text-[11px] leading-none font-bold tracking-wider uppercase">
              START NODE
            </h3>
            <p className="text-subtle-copy font-mono text-[10px] leading-none">
              WORKFLOW ENTRY
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-subtle-copy hover:text-ink hover:bg-panel-hover h-6 w-6 rounded-[2px]"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="flex-1 bg-transparent">
        <div className="space-y-3 p-3">
          <p className="text-muted-copy text-[11px] leading-relaxed">
            This is the entry point for your workflow. Connect this node to the
            first action you want to perform.
          </p>
          <p className="text-muted-copy text-[11px] leading-relaxed">
            Use the "Start Browser" and "Select List" nodes from the Control
            Flow category to set up your workflow appropriately.
          </p>
        </div>
      </ScrollArea>
    </div>
  )
}

// ============================================================================
// Activity Node Settings
// ============================================================================

interface ActivityNodeSettingsProps {
  node: Node
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void
  onClose: () => void
}

function ActivityNodeSettings({
  node,
  onUpdate,
  onClose,
}: ActivityNodeSettingsProps) {
  const activityId = node.data?.activityId as string
  const activity = getActivityById(activityId)
  const initialConfig = (node.data?.config as Record<string, unknown>) || {}

  const [config, setConfig] = useState<Record<string, unknown>>(initialConfig)

  const handleChange = useCallback((name: string, value: unknown) => {
    setConfig((prev) => ({ ...prev, [name]: value }))
  }, [])

  const handleSave = useCallback(() => {
    onUpdate(node.id, {
      ...node.data,
      config,
    })
  }, [node.id, node.data, config, onUpdate])

  if (!activity) {
    return (
      <div className="border-line bg-panel flex w-[320px] shrink-0 flex-col border-l">
        <div className="border-line-soft bg-panel-subtle flex shrink-0 items-center justify-between border-b px-3 py-2">
          <h3 className="text-ink text-[11px] leading-none font-bold tracking-wider uppercase">
            Unknown Activity
          </h3>
          <Button
            variant="ghost"
            size="icon"
            className="text-subtle-copy hover:text-ink hover:bg-panel-hover h-6 w-6 rounded-[2px]"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="text-subtle-copy p-3 text-[11px]">
          Activity "{activityId}" not found in registry
        </div>
      </div>
    )
  }

  return (
    <div className="border-line bg-panel flex w-[320px] shrink-0 flex-col border-l">
      <div className="border-line-soft bg-panel-subtle flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <div
            className="border-line rounded-[2px] border p-1"
            style={{ backgroundColor: `${activity.color}15` }}
          >
            <Settings2
              className="h-3.5 w-3.5"
              style={{ color: activity.color }}
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <h3 className="text-ink text-[11px] leading-none font-bold tracking-wider uppercase">
              {activity.name}
            </h3>
            <p className="text-subtle-copy font-mono text-[10px] leading-none">
              {activity.category.toUpperCase()}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-subtle-copy hover:text-ink hover:bg-panel-hover h-6 w-6 rounded-[2px]"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="flex-1 bg-transparent">
        <div className="space-y-3 p-3">
          <p className="text-subtle-copy border-line-soft border-b pb-2 text-[10px] leading-tight">
            {activity.description}
          </p>

          {activity.inputs.length === 0 ? (
            <p className="text-subtle-copy text-[11px]">
              This activity has no configurable inputs.
            </p>
          ) : (
            <GroupedInputs
              inputs={activity.inputs}
              config={config}
              onChange={handleChange}
            />
          )}
        </div>
      </ScrollArea>

      <div className="border-line bg-panel-subtle border-t p-2">
        <Button
          className="brand-button h-6 w-full rounded-[3px] text-[11px]"
          size="sm"
          onClick={handleSave}
        >
          Apply Changes
        </Button>
      </div>
    </div>
  )
}



