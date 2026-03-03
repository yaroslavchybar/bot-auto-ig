import { useCallback, useEffect, useState } from 'react'
import type { Node } from 'reactflow'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getActivityById } from '@/lib/activities/index'
import { X, Play, Settings2 } from 'lucide-react'
import { GroupedInputs } from '@/lib/activities/components/GroupedInputs'

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
		return (
			<StartNodeSettings
				onClose={onClose}
			/>
		)
	}

	return (
		<ActivityNodeSettings
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
		<div className="w-[320px] border-l border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 flex flex-col shrink-0">
			<div className="px-3 py-2 border-b border-neutral-300 dark:border-neutral-700 bg-neutral-200/50 dark:bg-neutral-900/50 flex items-center justify-between shrink-0">
				<div className="flex items-center gap-2">
					<div className="p-1 rounded-[2px] bg-green-500/10">
						<Play className="w-3.5 h-3.5 text-green-600 dark:text-green-500" />
					</div>
					<div className="flex flex-col gap-0.5">
						<h3 className="text-[11px] font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300 leading-none">START NODE</h3>
						<p className="text-[10px] text-neutral-500 dark:text-neutral-400 font-mono leading-none">WORKFLOW ENTRY</p>
					</div>
				</div>
				<Button variant="ghost" size="icon" className="h-6 w-6 rounded-[2px] text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-300/50 dark:hover:bg-neutral-700/50" onClick={onClose}>
					<X className="h-3.5 w-3.5" />
				</Button>
			</div>

			<ScrollArea className="flex-1 bg-white dark:bg-[#121212]">
				<div className="p-4 space-y-3">
					<p className="text-[11px] text-neutral-500 leading-relaxed">
						This is the entry point for your workflow. Connect this node to the first action you want to perform.
					</p>
					<p className="text-[11px] text-neutral-500 leading-relaxed">
						Use the "Start Browser" and "Select List" nodes from the Control Flow category to set up your workflow appropriately.
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

function ActivityNodeSettings({ node, onUpdate, onClose }: ActivityNodeSettingsProps) {
	const activityId = node.data?.activityId as string
	const activity = getActivityById(activityId)
	const initialConfig = (node.data?.config as Record<string, unknown>) || {}

	const [config, setConfig] = useState<Record<string, unknown>>(initialConfig)

	// Sync when node changes
	useEffect(() => {
		setConfig((node.data?.config as Record<string, unknown>) || {})
	}, [node.id, node.data?.config])

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
			<div className="w-[320px] border-l border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 flex flex-col shrink-0">
				<div className="px-3 py-2 border-b border-neutral-300 dark:border-neutral-700 bg-neutral-200/50 dark:bg-neutral-900/50 flex items-center justify-between shrink-0">
					<h3 className="text-[11px] font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300 leading-none">Unknown Activity</h3>
					<Button variant="ghost" size="icon" className="h-6 w-6 rounded-[2px]" onClick={onClose}>
						<X className="h-3.5 w-3.5" />
					</Button>
				</div>
				<div className="p-4 text-[11px] text-neutral-500">
					Activity "{activityId}" not found in registry
				</div>
			</div>
		)
	}

	return (
		<div className="w-[320px] border-l border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 flex flex-col shrink-0">
			<div className="px-3 py-2 border-b border-neutral-300 dark:border-neutral-700 bg-neutral-200/50 dark:bg-neutral-900/50 flex items-center justify-between shrink-0">
				<div className="flex items-center gap-2">
					<div
						className="p-1 rounded-[2px]"
						style={{ backgroundColor: `${activity.color}15` }}
					>
						<Settings2 className="w-3.5 h-3.5" style={{ color: activity.color }} />
					</div>
					<div className="flex flex-col gap-0.5">
						<h3 className="text-[11px] font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300 leading-none">{activity.name}</h3>
						<p className="text-[10px] text-neutral-500 dark:text-neutral-400 font-mono leading-none">{activity.category.toUpperCase()}</p>
					</div>
				</div>
				<Button variant="ghost" size="icon" className="h-6 w-6 rounded-[2px]" onClick={onClose}>
					<X className="h-3.5 w-3.5" />
				</Button>
			</div>

			<ScrollArea className="flex-1 bg-white dark:bg-[#121212]">
				<div className="p-3 space-y-3">
					<p className="text-[10px] text-neutral-500 leading-tight border-b border-neutral-200 dark:border-neutral-800 pb-2">{activity.description}</p>

					{activity.inputs.length === 0 ? (
						<p className="text-[11px] text-neutral-500">
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

			<div className="p-3 border-t">
				<Button className="w-full" size="sm" onClick={handleSave}>
					Apply Changes
				</Button>
			</div>
		</div>
	)
}

