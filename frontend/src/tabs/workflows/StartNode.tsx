import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { Play, Settings } from 'lucide-react'

export interface StartNodeData {
	// Settings moved to specific nodes
}

function StartNodeComponent({ selected }: NodeProps<StartNodeData>) {

	return (
		<div
			className={`
				w-[180px] bg-white rounded flex flex-col overflow-hidden
				${selected ? 'ring-1 ring-[#2ECC71]' : 'shadow-sm border border-neutral-200'}
			`}
		>
			<div className="flex h-full w-full relative">
				{/* Left colored border strip */}
				<div className="w-1 bg-[#2ECC71] shrink-0 h-full absolute left-0 top-0 bottom-0" />

				<div className="flex flex-col w-full pl-1">
					{/* Header */}
					<div className="flex items-center gap-2.5 p-2.5 pb-2">
						<div className="w-6 h-6 rounded bg-[#EAFBF1] flex items-center justify-center shrink-0">
							<Play className="w-3.5 h-3.5 text-[#2ECC71]" fill="none" strokeWidth={2} />
						</div>
						<div className="flex flex-col gap-0.5">
							<span className="text-[11px] font-bold text-neutral-800 leading-none">START</span>
							<span className="text-[9px] text-neutral-500 uppercase tracking-widest leading-none">WORKFLOW ENTRY</span>
						</div>
					</div>

					{/* Settings Overview removed */}
					<div className="py-2 border-t border-neutral-100 flex items-center justify-center gap-1.5 text-[9px] text-neutral-400 uppercase tracking-widest bg-neutral-50/50">
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
