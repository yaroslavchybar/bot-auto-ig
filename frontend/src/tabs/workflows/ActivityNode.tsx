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

function ActivityNodeComponent({ data, selected }: NodeProps<ActivityNodeData>) {
	const activity = getActivityById(data.activityId)

	const Icon = activity ? iconMap[activity.icon] || HelpCircle : HelpCircle
	const color = activity?.color || '#6b7280'

	return (
		<div
			className={`
				px-4 py-3 shadow-md rounded-lg border-2 bg-background min-w-[160px]
				${selected ? 'border-primary ring-2 ring-primary/20' : 'border-border'}
			`}
			style={{ borderLeftColor: color, borderLeftWidth: 4 }}
		>
			{/* Input handle */}
			<Handle
				type="target"
				position={Position.Top}
				className="!bg-muted-foreground !w-3 !h-3 !border-2 !border-background"
			/>

			{/* Content */}
			<div className="flex items-center gap-2">
				<div
					className="p-1.5 rounded"
					style={{ backgroundColor: `${color}20` }}
				>
					<Icon className="w-4 h-4" style={{ color }} />
				</div>
				<div className="flex flex-col">
					<span className="text-sm font-medium">{data.label || activity?.name || 'Unknown'}</span>
					{activity && (
						<span className="text-xs text-muted-foreground">{activity.category}</span>
					)}
				</div>
			</div>

			{/* Output handles based on activity outputs */}
			{activity && activity.outputs.length === 1 && (
				<Handle
					type="source"
					position={Position.Bottom}
					className="!bg-muted-foreground !w-3 !h-3 !border-2 !border-background"
				/>
			)}

			{activity && activity.outputs.length > 1 && (
				<div className="flex justify-around mt-2 pt-2 border-t">
					{activity.outputs.map((output) => (
						<div key={output} className="relative flex flex-col items-center">
							<span className="text-[10px] text-muted-foreground mb-1">{output}</span>
							<Handle
								type="source"
								position={Position.Bottom}
								id={output}
								className="!bg-muted-foreground !w-2.5 !h-2.5 !border-2 !border-background !relative !transform-none !left-auto !right-auto"
								style={{ bottom: -12 }}
							/>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

export const ActivityNode = memo(ActivityNodeComponent)
