import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { Play, Settings } from 'lucide-react'

export type StartNodeData = Record<string, never>

function StartNodeComponent({ selected }: NodeProps<StartNodeData>) {

	return (
		<div
			className={`
				w-[180px] bg-[#0a0a0a] rounded-[3px] flex flex-col overflow-hidden border
				${selected ? 'border-white/20 shadow-[0_0_15px_rgba(239,68,68,0.3)]' : 'shadow-[0_4px_20px_rgba(0,0,0,0.5)] border-white/10'}
			`}
		>
			<div className="flex h-full w-full relative">
				{/* Left colored border strip */}
				<div className="w-1 bg-[#2ECC71] shrink-0 h-full absolute left-0 top-0 bottom-0 rounded-l-[3px]" />

				<div className="flex flex-col w-full pl-1">
					{/* Header */}
					<div className="flex items-center gap-2 p-2 pb-1.5 border-b border-white/5 bg-white/[0.02]">
						<div className="w-5 h-5 rounded-[2px] bg-[#163526] border border-[#2ECC71]/30 flex items-center justify-center shrink-0">
							<Play className="w-3 h-3 text-[#2ECC71]" fill="none" strokeWidth={2} />
						</div>
						<div className="flex flex-col gap-0.5">
							<span className="text-[10px] font-bold text-gray-200 uppercase tracking-wider leading-none">Start</span>
							<span className="text-[9px] text-gray-500 uppercase tracking-widest leading-none font-mono">Workflow Entry</span>
						</div>
					</div>

					{/* Settings Overview removed */}
					<div className="py-1.5 border-t border-white/5 flex items-center justify-center gap-1.5 text-[9px] text-gray-500 uppercase tracking-widest bg-transparent font-mono">
						<Settings className="w-3 h-3" />
						<span>Click to configure</span>
					</div>
				</div>
			</div>

			{/* Output handle */}
			<Handle
				type="source"
				position={Position.Right}
				className="!bg-[#94a3b8] !w-2.5 !h-2.5 !border-0 !rounded-full"
				style={{ right: -5 }}
			/>
		</div>
	)
}

export const StartNode = memo(StartNodeComponent)

export const DEFAULT_START_DATA: StartNodeData = {}
