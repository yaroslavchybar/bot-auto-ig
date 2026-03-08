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
				min-w-[180px] bg-[#0a0a0a] rounded-[3px] flex flex-col overflow-visible relative border
				${selected ? 'border-white/20 shadow-[0_0_15px_rgba(239,68,68,0.3)]' : 'shadow-[0_4px_20px_rgba(0,0,0,0.5)] border-white/10'}
			`}
		>
			<div className="flex h-full w-full relative">
				{/* Left colored border strip */}
				<div
					className="w-1 shrink-0 absolute left-0 top-0 bottom-0 rounded-l-[3px]"
					style={{ backgroundColor: color }}
				/>

				<div className="flex flex-col w-full pl-1">
					{/* Input handle */}
					<Handle
						type="target"
						position={Position.Left}
						className="!bg-[#94a3b8] !w-2.5 !h-2.5 !border-0 !rounded-full"
						style={{ left: -5 }}
					/>

					{/* Header */}
					<div className="flex items-center gap-2 p-2 pb-1.5 border-b border-white/5 bg-white/[0.02]">
						<div
							className="w-5 h-5 rounded-[2px] flex items-center justify-center shrink-0 border border-white/10"
							style={{ backgroundColor: `${color}18` }}
						>
							<Icon className="w-3 h-3" style={{ color }} strokeWidth={2} />
						</div>
						<div className="flex flex-col gap-0.5">
							<span className="text-[10px] font-bold text-gray-200 uppercase tracking-wider leading-none">
								{data.label || activity?.name || 'Unknown'}
							</span>
							{activity && (
								<span className="text-[9px] text-gray-500 uppercase tracking-widest leading-none font-mono">
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
							className="!bg-[#94a3b8] !w-2.5 !h-2.5 !border-0 !rounded-full"
							style={{ right: -5 }}
						/>
					)}

					{/* Multiple Output handles with labels */}
					{activity && activity.outputs.length > 1 && (
						<div className="flex flex-col bg-transparent">
							{activity.outputs.map((output) => (
								<div key={output} className="relative flex items-center justify-end px-2 py-1 border-b border-white/5 last:border-b-0">
									<span className="text-[9px] uppercase tracking-widest text-gray-500 mr-2 font-mono">{output}</span>
									<Handle
										type="source"
										position={Position.Right}
										id={output}
										className="!bg-[#94a3b8] !w-2.5 !h-2.5 !border-0 !rounded-full !absolute !right-[-5px] !top-1/2 !translate-x-0 !-translate-y-1/2"
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
