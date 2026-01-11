import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { Play, Settings } from 'lucide-react'

export interface StartNodeData {
	headlessMode: boolean
	profileReopenCooldown: number
	messagingCooldown: number
	sourceLists: string[]
}

function StartNodeComponent({ data, selected }: NodeProps<StartNodeData>) {
	const listsCount = data.sourceLists?.length || 0

	return (
		<div
			className={`
				px-4 py-3 shadow-md rounded-lg border-2 bg-background min-w-[180px]
				${selected ? 'border-primary ring-2 ring-primary/20' : 'border-green-500'}
			`}
			style={{ borderLeftColor: '#22c55e', borderLeftWidth: 4 }}
		>
			{/* Content */}
			<div className="flex items-center gap-2">
				<div className="p-2 rounded bg-green-500/20">
					<Play className="w-5 h-5 text-green-500" />
				</div>
				<div className="flex flex-col">
					<span className="text-sm font-semibold">Start</span>
					<span className="text-xs text-muted-foreground">Workflow Entry</span>
				</div>
			</div>

			{/* Settings Summary */}
			<div className="mt-3 pt-2 border-t space-y-1">
				<div className="flex items-center justify-between text-xs">
					<span className="text-muted-foreground">Headless</span>
					<span className={data.headlessMode ? 'text-green-500' : 'text-muted-foreground'}>
						{data.headlessMode ? 'Yes' : 'No'}
					</span>
				</div>
				<div className="flex items-center justify-between text-xs">
					<span className="text-muted-foreground">Cooldown</span>
					<span>{data.profileReopenCooldown || 0}min</span>
				</div>
				<div className="flex items-center justify-between text-xs">
					<span className="text-muted-foreground">Msg Cooldown</span>
					<span>{data.messagingCooldown || 0}h</span>
				</div>
				<div className="flex items-center justify-between text-xs">
					<span className="text-muted-foreground">Lists</span>
					<span>{listsCount} selected</span>
				</div>
			</div>

			{/* Click hint */}
			<div className="mt-2 pt-2 border-t flex items-center justify-center gap-1 text-xs text-muted-foreground">
				<Settings className="w-3 h-3" />
				<span>Click to configure</span>
			</div>

			{/* Output handle */}
			<Handle
				type="source"
				position={Position.Bottom}
				className="!bg-green-500 !w-3 !h-3 !border-2 !border-background"
			/>
		</div>
	)
}

export const StartNode = memo(StartNodeComponent)

export const DEFAULT_START_DATA: StartNodeData = {
	headlessMode: false,
	profileReopenCooldown: 30,
	messagingCooldown: 24,
	sourceLists: [],
}
