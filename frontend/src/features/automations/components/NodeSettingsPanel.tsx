import { useCallback, useState } from 'react'
import type { Node } from 'reactflow'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getActivityById, type ActivityDefinition } from '@/features/automations/activities/index'
import { START_NODE_INPUTS } from './StartNode'
import { X, Play } from 'lucide-react'
import { GroupedInputs } from '@/features/automations/activity-ui/GroupedInputs'
import { WarmUpStatesTable } from './WarmUpStatesTable'
import { ActivityIcon } from './activityIcons'
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
  if (!selectedNode) {
    return null
  }

  const isStartNode = selectedNode.type === 'start'

  if (isStartNode) {
    return (
      <StartNodeSettings
        key={selectedNode.id}
        node={selectedNode}
        onUpdate={onUpdateNode}
        onClose={onClose}
        suppressed={suppressed}
      />
    )
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
// Settings Panel Shell
// ============================================================================

function SettingsPanelShell({
  suppressed,
  children,
}: {
  suppressed: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'border-line-soft bg-panel/95 flex max-h-full w-[380px] shrink-0 flex-col overflow-hidden rounded-2xl border shadow-xs backdrop-blur-sm',
        'animate-in slide-in-from-right-2 fade-in duration-200',
        suppressed && 'hidden',
      )}
    >
      {children}
    </div>
  )
}

// ============================================================================
// Settings Panel Header
// ============================================================================

function SettingsPanelHeader({
  icon,
  title,
  category,
  onClose,
}: {
  icon: React.ReactNode
  title: string
  category: string
  onClose: () => void
}) {
  return (
    <div className="border-line-soft bg-panel-subtle relative shrink-0 border-b px-4 py-3">
      <div className="flex items-center gap-2.5">
        {icon}
        <div className="min-w-0 flex-1">
          <h3 className="text-ink truncate text-sm leading-tight font-semibold">
            {title}
          </h3>
          <div className="text-subtle-copy mt-0.5 truncate text-[11px]">
            {category}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close settings"
          className="text-subtle-copy hover:text-ink hover:bg-panel-hover -mt-0.5 -mr-1 h-7 w-7 shrink-0 rounded-lg transition-colors duration-150"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// ============================================================================
// Start Node Settings
// ============================================================================

interface StartNodeSettingsProps {
  node: Node
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void
  onClose: () => void
  suppressed?: boolean
}

function StartNodeSettings({
  node,
  onUpdate,
  onClose,
  suppressed = false,
}: StartNodeSettingsProps) {
  const initialConfig =
    (node.data?.config as Record<string, unknown>) || {}
  const [config, setConfig] = useState<Record<string, unknown>>(initialConfig)

  const handleChange = useCallback((name: string, value: unknown) => {
    const base = (node.data?.config as Record<string, unknown>) || {}
    const next = { ...base, [name]: value }
    setConfig(next)
    // Live-apply: no Apply button needed.
    onUpdate(node.id, { ...node.data, config: next })
  }, [node.id, node.data, onUpdate])

  return (
    <SettingsPanelShell suppressed={suppressed}>
      <SettingsPanelHeader
        icon={
          <div className="border-line-soft bg-panel-subtle rounded-lg border p-2">
            <Play className="text-ink h-4 w-4" />
          </div>
        }
        title="Start"
        category="Entry point"
        onClose={onClose}
      />
      <ScrollArea className="min-h-0 flex-1 bg-transparent">
        <div className="space-y-4 p-4">
          <GroupedInputs
            inputs={START_NODE_INPUTS}
            config={config}
            onChange={handleChange}
          />
        </div>
      </ScrollArea>
    </SettingsPanelShell>
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

/* ── Unknown activity fallback ── */

function UnknownActivityPanel({
  activityId,
  suppressed,
  onClose,
}: {
  activityId: string
  suppressed: boolean
  onClose: () => void
}) {
  return (
    <SettingsPanelShell suppressed={suppressed}>
      <div className="border-line-soft bg-panel-subtle flex shrink-0 items-center justify-between border-b px-4 py-3">
        <h3 className="text-ink text-sm leading-none font-semibold">Unknown Activity</h3>
        <Button
          variant="ghost" size="icon"
          className="text-subtle-copy hover:text-ink hover:bg-panel-hover h-8 w-8 rounded-lg"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="text-subtle-copy p-4 text-sm">
        Activity &quot;{activityId}&quot; not found in registry
      </div>
    </SettingsPanelShell>
  )
}

/* ── Activity settings body ── */

function ActivitySettingsBody({
  activity,
  config,
  onChange,
}: {
  activity: ActivityDefinition
  config: Record<string, unknown>
  onChange: (name: string, value: unknown) => void
}) {
  return (
    <ScrollArea className="min-h-0 flex-1 bg-transparent">
      <div className="space-y-4 p-4">
        {activity.inputs.length === 0 ? (
          <p className="text-subtle-copy text-sm">This activity has no configurable inputs.</p>
        ) : (
          <GroupedInputs inputs={activity.inputs} config={config} onChange={onChange} />
        )}
        {activity.id === 'browse_feed' ? <WarmUpStatesTable /> : null}
      </div>
    </ScrollArea>
  )
}

function ActivityNodeSettings({
  node, onUpdate, onClose, suppressed = false,
}: ActivityNodeSettingsProps) {
  const activityId = node.data?.activityId as string
  const activity = getActivityById(activityId)
  const initialConfig = (node.data?.config as Record<string, unknown>) || {}
  const [config, setConfig] = useState<Record<string, unknown>>(initialConfig)

  const handleChange = useCallback((name: string, value: unknown) => {
    const base = (node.data?.config as Record<string, unknown>) || {}
    const next = { ...base, [name]: value }
    setConfig(next)
    // Live-apply: no Apply button needed.
    onUpdate(node.id, { ...node.data, config: next })
  }, [node.id, node.data, onUpdate])

  if (!activity) {
    return <UnknownActivityPanel activityId={activityId} suppressed={suppressed} onClose={onClose} />
  }

  return (
    <SettingsPanelShell suppressed={suppressed}>
      <SettingsPanelHeader
        icon={
          <div className="border-line-soft bg-panel-subtle rounded-lg border p-2">
            <ActivityIcon
              iconName={activity.icon}
              className="text-ink h-4 w-4"
            />
          </div>
        }
        title={activity.name}
        category={activity.category}
        onClose={onClose}
      />
      <ActivitySettingsBody activity={activity} config={config} onChange={handleChange} />
    </SettingsPanelShell>
  )
}
