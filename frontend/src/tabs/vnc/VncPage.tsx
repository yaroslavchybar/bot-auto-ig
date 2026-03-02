import { VncViewer } from '@/components/VncViewer'
import { LogsViewer } from '@/components/LogsViewer'
import { Panel, Group, Separator } from 'react-resizable-panels'

export function VncPage() {
	return (
		<div className="flex flex-col h-full bg-neutral-200 dark:bg-neutral-900 overflow-hidden font-sans">
			{/* Utilitarian Header Menu Ribbon */}
			<div className="flex items-center justify-between px-3 py-1.5 bg-neutral-100 dark:bg-neutral-800 border-b border-neutral-300 dark:border-neutral-700 shrink-0 select-none shadow-sm z-10">
				<div className="flex items-center gap-3">
					<div className="flex items-baseline gap-2">
						<h2 className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
							Workspace Session
						</h2>
						<span className="text-[10px] text-neutral-500 font-mono">
							[LIVE AUTOMATION VIEW]
						</span>
					</div>
				</div>
			</div>

			{/* Resizable Desktop UI Grid Layout */}
			<div className="flex-1 min-h-0 p-1">
				<Group
					orientation="horizontal"
					id="vnc-page-layout-group"
					onLayoutChanged={(layout) => {
						localStorage.setItem('vnc-page-layout-sizes', JSON.stringify(layout))
					}}
					defaultLayout={(() => {
						try {
							const stored = localStorage.getItem('vnc-page-layout-sizes')
							return stored ? JSON.parse(stored) : undefined
						} catch {
							return undefined
						}
					})()}
				>
					{/* Left Column: VNC Viewer */}
					<Panel id="left-vnc" defaultSize={60} minSize={30}>
						<div className="flex flex-col h-full bg-black border border-neutral-300 dark:border-neutral-700 rounded-[3px] shadow-sm relative overflow-hidden group">
							{/* Status Bar Overlay */}
							<div className="absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-black/80 to-transparent z-10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center px-2 pointer-events-none">
								<div className="text-[10px] text-white/70 font-mono tracking-widest uppercase">
									Display Stream :0
								</div>
							</div>
							<VncViewer className="flex-1 w-full h-full object-contain" />
						</div>
					</Panel>

					{/* Resize Handle */}
					<Separator className="w-2 relative mx-0.5 flex items-center justify-center transition-colors hover:bg-neutral-300/50 dark:hover:bg-neutral-700/50 rounded group focus:outline-none focus:ring-0 active:outline-none">
						<div className="w-1 h-8 bg-neutral-300 dark:bg-neutral-600 rounded-full group-hover:bg-neutral-400 dark:group-hover:bg-neutral-500 transition-colors" />
					</Separator>

					{/* Right Column: Logs Viewer */}
					<Panel id="right-logs" defaultSize={40} minSize={20}>
						<div className="flex flex-col h-full rounded-[3px] overflow-hidden shadow-sm">
							<LogsViewer className="h-full border-0" />
						</div>
					</Panel>
				</Group>
			</div>
		</div>
	)
}

