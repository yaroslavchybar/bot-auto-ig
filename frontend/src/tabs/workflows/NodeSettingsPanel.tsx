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
		<div className="w-[320px] border-l border-white/10 bg-[#0a0a0a] flex flex-col shrink-0">
			<div className="px-3 py-2 border-b border-white/5 bg-white/[0.02] flex items-center justify-between shrink-0">
				<div className="flex items-center gap-2">
					<div className="p-1 rounded-[2px] bg-green-500/10 border border-green-500/20">
						<Play className="w-3.5 h-3.5 text-green-500" />
					</div>
					<div className="flex flex-col gap-0.5">
						<h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-200 leading-none">START NODE</h3>
						<p className="text-[10px] text-gray-500 font-mono leading-none">WORKFLOW ENTRY</p>
					</div>
				</div>
				<Button variant="ghost" size="icon" className="h-6 w-6 rounded-[2px] text-gray-500 hover:text-gray-200 hover:bg-white/10" onClick={onClose}>
					<X className="h-3.5 w-3.5" />
				</Button>
			</div>

			<ScrollArea className="flex-1 bg-transparent">
				<div className="p-3 space-y-3">
					<p className="text-[11px] text-gray-400 leading-relaxed">
						This is the entry point for your workflow. Connect this node to the first action you want to perform.
					</p>
					<p className="text-[11px] text-gray-400 leading-relaxed">
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
			<div className="w-[320px] border-l border-white/10 bg-[#0a0a0a] flex flex-col shrink-0">
				<div className="px-3 py-2 border-b border-white/5 bg-white/[0.02] flex items-center justify-between shrink-0">
					<h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-200 leading-none">Unknown Activity</h3>
					<Button variant="ghost" size="icon" className="h-6 w-6 rounded-[2px] text-gray-500 hover:text-gray-200 hover:bg-white/10" onClick={onClose}>
						<X className="h-3.5 w-3.5" />
					</Button>
				</div>
				<div className="p-3 text-[11px] text-gray-500">
					Activity "{activityId}" not found in registry
				</div>
			</div>
		)
	}

	return (
		<div className="w-[320px] border-l border-white/10 bg-[#0a0a0a] flex flex-col shrink-0">
			<div className="px-3 py-2 border-b border-white/5 bg-white/[0.02] flex items-center justify-between shrink-0">
				<div className="flex items-center gap-2">
					<div
						className="p-1 rounded-[2px] border border-white/10"
						style={{ backgroundColor: `${activity.color}15` }}
					>
						<Settings2 className="w-3.5 h-3.5" style={{ color: activity.color }} />
					</div>
					<div className="flex flex-col gap-0.5">
						<h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-200 leading-none">{activity.name}</h3>
						<p className="text-[10px] text-gray-500 font-mono leading-none">{activity.category.toUpperCase()}</p>
					</div>
				</div>
				<Button variant="ghost" size="icon" className="h-6 w-6 rounded-[2px] text-gray-500 hover:text-gray-200 hover:bg-white/10" onClick={onClose}>
					<X className="h-3.5 w-3.5" />
				</Button>
			</div>

			<ScrollArea className="flex-1 bg-transparent">
				<div className="p-3 space-y-3">
					<p className="text-[10px] text-gray-500 leading-tight border-b border-white/5 pb-2">{activity.description}</p>

					{activity.inputs.length === 0 ? (
						<p className="text-[11px] text-gray-500">
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

			<div className="p-2 border-t border-white/10 bg-white/[0.02]">
				<Button className="w-full h-6 rounded-[3px] text-[11px] bg-gradient-to-r from-red-600 to-orange-500 border-none shadow-[0_0_15px_rgba(239,68,68,0.4)] hover:shadow-[0_0_25px_rgba(239,68,68,0.6)] text-white" size="sm" onClick={handleSave}>
					Apply Changes
				</Button>
			</div>
		</div>
	)
}

