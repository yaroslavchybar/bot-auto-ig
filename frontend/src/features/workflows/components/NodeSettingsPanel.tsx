import { useCallback, useState } from 'react'
import type { Node } from 'reactflow'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getActivityById } from '@/features/workflows/activities/index'
import { X, Play, Settings2 } from 'lucide-react'
import { GroupedInputs } from '@/features/workflows/activity-ui/GroupedInputs'
import { cn } from '@/lib/utils'

interface NodeSettingsPanelProps {
  selectedNode: Node | null
  onUpdateNode: (nodeId: string, data: Record<string, unknown>) => void
  onClose: () => void
  suppressed?: boolean
}

export function NodeSettingsPanel({
  selectedNode,
  onUpdateNode,
  onClose,
  suppressed = false,
}: NodeSettingsPanelProps) {
  // Hide panel when no node selected
  if (!selectedNode) {
    return null
  }

  const isStartNode = selectedNode.type === 'start'

  if (isStartNode) {
    return <StartNodeSettings onClose={onClose} suppressed={suppressed} />
  }

  return (
    <ActivityNodeSettings
      key={selectedNode.id}
      node={selectedNode}
      onUpdate={onUpdateNode}
      onClose={onClose}
      suppressed={suppressed}
    />
  )
}

// ============================================================================
// Start Node Settings
// ============================================================================

interface StartNodeSettingsProps {
  onClose: () => void
  suppressed?: boolean
}

function StartNodeSettings({
  onClose,
  suppressed = false,
}: StartNodeSettingsProps) {
  return (
    <div
      className={cn(
        'border-line-soft bg-panel/95 flex w-[360px] shrink-0 flex-col overflow-hidden rounded-2xl border shadow-xs backdrop-blur-xs',
        suppressed && 'hidden',
      )}
    >
      <div className="border-line-soft bg-panel-subtle flex shrink-0 items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="bg-status-success-soft border-status-success-border rounded-lg border p-2">
            <Play className="text-status-success h-4 w-4" />
          </div>
          <div className="flex flex-col gap-0.5">
            <h3 className="text-ink text-sm leading-none font-semibold">
              Start Node
            </h3>
            <p className="text-subtle-copy font-mono text-[10px] leading-none tracking-[0.18em] uppercase">
              Workflow Entry
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-subtle-copy hover:text-ink hover:bg-panel-hover h-8 w-8 rounded-lg"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 bg-transparent">
        <div className="space-y-3 p-4">
          <p className="text-muted-copy text-sm leading-relaxed">
            This is the entry point for your workflow. Connect this node to the
            first action you want to perform.
          </p>
          <p className="text-muted-copy text-sm leading-relaxed">
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
  suppressed?: boolean
}

function ActivityNodeSettings({
  node,
  onUpdate,
  onClose,
  suppressed = false,
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
      <div
        className={cn(
          'border-line-soft bg-panel/95 flex w-[360px] shrink-0 flex-col overflow-hidden rounded-2xl border shadow-xs backdrop-blur-xs',
          suppressed && 'hidden',
        )}
      >
        <div className="border-line-soft bg-panel-subtle flex shrink-0 items-center justify-between border-b px-4 py-3">
          <h3 className="text-ink text-sm leading-none font-semibold">
            Unknown Activity
          </h3>
          <Button
            variant="ghost"
            size="icon"
            className="text-subtle-copy hover:text-ink hover:bg-panel-hover h-8 w-8 rounded-lg"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="text-subtle-copy p-4 text-sm">
          Activity "{activityId}" not found in registry
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'border-line-soft bg-panel/95 flex w-[360px] shrink-0 flex-col overflow-hidden rounded-2xl border shadow-xs backdrop-blur-xs',
        suppressed && 'hidden',
      )}
    >
      <div className="border-line-soft bg-panel-subtle flex shrink-0 items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <div
            className="border-line rounded-lg border p-2"
            style={{ backgroundColor: `${activity.color}15` }}
          >
            <Settings2
              className="h-4 w-4"
              style={{ color: activity.color }}
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <h3 className="text-ink text-sm leading-none font-semibold">
              {activity.name}
            </h3>
            <p className="text-subtle-copy font-mono text-[10px] leading-none tracking-[0.18em] uppercase">
              {activity.category}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-subtle-copy hover:text-ink hover:bg-panel-hover h-8 w-8 rounded-lg"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 bg-transparent">
        <div className="space-y-4 p-4">
          <p className="text-subtle-copy border-line-soft border-b pb-3 text-xs leading-relaxed">
            {activity.description}
          </p>

          {activity.inputs.length === 0 ? (
            <p className="text-subtle-copy text-sm">
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

      <div className="border-line-soft bg-panel-subtle border-t p-3">
        <Button
          className="brand-button h-9 w-full rounded-lg text-sm"
          size="sm"
          onClick={handleSave}
        >
          Apply Changes
        </Button>
      </div>
    </div>
  )
}



