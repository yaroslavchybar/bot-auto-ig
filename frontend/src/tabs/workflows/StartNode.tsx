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
				w-[180px] bg-neutral-100 dark:bg-neutral-900 rounded-[3px] flex flex-col overflow-hidden border
				${selected ? 'border-[#2ECC71] shadow-[0_0_0_1px_rgba(46,204,113,0.35)]' : 'shadow-sm border-neutral-300 dark:border-neutral-700'}
			`}
		>
			<div className="flex h-full w-full relative">
				{/* Left colored border strip */}
				<div className="w-1 bg-[#2ECC71] shrink-0 h-full absolute left-0 top-0 bottom-0 rounded-l-[3px]" />

				<div className="flex flex-col w-full pl-1">
					{/* Header */}
					<div className="flex items-center gap-2 p-2 pb-1.5 border-b border-neutral-200 dark:border-neutral-700/80 bg-white/70 dark:bg-neutral-900/70">
						<div className="w-5 h-5 rounded-[2px] bg-[#EAFBF1] border border-[#2ECC71]/25 flex items-center justify-center shrink-0 dark:bg-[#163526] dark:border-[#2ECC71]/30">
							<Play className="w-3 h-3 text-[#2ECC71]" fill="none" strokeWidth={2} />
						</div>
						<div className="flex flex-col gap-0.5">
							<span className="text-[10px] font-bold text-neutral-800 dark:text-neutral-200 uppercase tracking-wider leading-none">Start</span>
							<span className="text-[9px] text-neutral-500 dark:text-neutral-400 uppercase tracking-widest leading-none font-mono">Workflow Entry</span>
						</div>
					</div>

					{/* Settings Overview removed */}
					<div className="py-1.5 border-t border-neutral-200 dark:border-neutral-700/80 flex items-center justify-center gap-1.5 text-[9px] text-neutral-500 dark:text-neutral-400 uppercase tracking-widest bg-white dark:bg-[#121212] font-mono">
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
