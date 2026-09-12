import { useCallback, useEffect, useState } from 'react'
import type { Node } from 'reactflow'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getActivityById, type ActivityDefinition } from '@/features/workflows/activities/index'
import { X, Play, Info } from 'lucide-react'
import { GroupedInputs } from '@/features/workflows/activity-ui/GroupedInputs'
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
  description,
  accentColor,
  onClose,
}: {
  icon: React.ReactNode
  title: string
  category: string
  description?: string
  accentColor?: string
  onClose: () => void
}) {
  return (
    <div className="border-line-soft bg-panel-subtle relative shrink-0 border-b px-4 py-3">
      <div className="flex items-start gap-2.5">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-ink truncate text-sm leading-tight font-semibold">
              {title}
            </h3>
            <span
              className="text-subtle-copy inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px font-mono text-[9px] tracking-[0.14em] uppercase"
              style={
                accentColor
                  ? {
                      borderColor: `color-mix(in srgb, ${accentColor} 30%, transparent)`,
                      backgroundColor: `color-mix(in srgb, ${accentColor} 8%, transparent)`,
                    }
                  : undefined
              }
            >
              {accentColor && (
                <span
                  className="h-1 w-1 rounded-full"
                  style={{ backgroundColor: accentColor }}
                />
              )}
              {category}
            </span>
          </div>
          {description && (
            <p className="text-subtle-copy mt-0.5 truncate text-xs">
              {description}
            </p>
          )}
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
      {accentColor && (
        <div
          className="absolute right-0 bottom-0 left-0 h-px"
          style={{
            background: `linear-gradient(to right, color-mix(in srgb, ${accentColor} 25%, transparent), transparent 80%)`,
          }}
        />
      )}
    </div>
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
    <SettingsPanelShell suppressed={suppressed}>
      <SettingsPanelHeader
        icon={
          <div className="bg-status-success-soft border-status-success-border rounded-lg border p-2 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
            <Play className="text-status-success h-4 w-4" />
          </div>
        }
        title="Start Node"
        category="Workflow Entry"
        description="Where this workflow begins"
        accentColor="#22c55e"
        onClose={onClose}
      />
      <ScrollArea className="flex-1 bg-transparent">
        <div className="space-y-3 p-4">
          <div className="bg-status-success-soft/20 flex items-start gap-2.5 rounded-lg px-3 py-2.5">
            <Info className="text-status-success mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" />
            <div className="space-y-2">
              <p className="text-muted-copy text-[11px] leading-relaxed">
                This is the entry point for your workflow. Connect this node to the
                first action you want to perform.
              </p>
              <p className="text-muted-copy text-[11px] leading-relaxed">
                Use the "Start Browser" and "Select List" nodes from the Control
                Flow category to set up your workflow appropriately.
              </p>
            </div>
          </div>
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
  const [baseline, setBaseline] =
    useState<Record<string, unknown>>(initialConfig)

  const handleChange = useCallback((name: string, value: unknown) => {
    setConfig((prev) => ({ ...prev, [name]: value }))
  }, [])

  const handleReset = useCallback(() => {
    setConfig(baseline)
  }, [baseline])

  const handleSave = useCallback(() => {
    onUpdate(node.id, { ...node.data, config })
    setBaseline(config)
  }, [node.id, node.data, config, onUpdate])

  const isDirty =
    JSON.stringify(config) !== JSON.stringify(baseline)

  // Ctrl/Cmd+Enter applies changes without leaving the panel.
  useEffect(() => {
    if (suppressed || !isDirty) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [suppressed, isDirty, handleSave])

  if (!activity) {
    return <UnknownActivityPanel activityId={activityId} suppressed={suppressed} onClose={onClose} />
  }

  return (
    <SettingsPanelShell suppressed={suppressed}>
      <SettingsPanelHeader
        icon={
          <div
            className="rounded-lg border p-2 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]"
            style={{
              backgroundColor: `color-mix(in srgb, ${activity.color} 8%, transparent)`,
              borderColor: `color-mix(in srgb, ${activity.color} 19%, transparent)`,
            }}
          >
            <ActivityIcon
              iconName={activity.icon}
              className="h-4 w-4"
              style={{ color: activity.color }}
            />
          </div>
        }
        title={activity.name}
        category={activity.category}
        description={activity.description}
        accentColor={activity.color}
        onClose={onClose}
      />
      <ActivitySettingsBody activity={activity} config={config} onChange={handleChange} />
      <div className="border-line-soft bg-panel-subtle flex shrink-0 items-center gap-2 border-t p-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReset}
          disabled={!isDirty}
          className="text-subtle-copy hover:text-ink h-9 shrink-0 rounded-lg px-3 text-[13px] disabled:opacity-40"
        >
          Reset
        </Button>
        <Button
          className="brand-button h-9 flex-1 rounded-lg text-sm transition-all duration-150 disabled:opacity-60"
          size="sm"
          disabled={!isDirty}
          onClick={handleSave}
          title={isDirty ? 'Apply changes (Ctrl+Enter)' : 'No changes to apply'}
        >
          <span className="inline-flex items-center gap-2">
            {isDirty && (
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
            )}
            {isDirty ? 'Apply Changes' : 'No Changes'}
          </span>
        </Button>
      </div>
    </SettingsPanelShell>
  )
}
