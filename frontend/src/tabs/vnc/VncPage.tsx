import { VncViewer } from '@/components/VncViewer'

export function VncPage() {
	return (
		<div className="flex flex-col h-full">
			<div className="flex items-center justify-between mb-4">
				<div>
					<h2 className="text-2xl font-bold tracking-tight">Browser View</h2>
					<p className="text-sm text-muted-foreground">
						Real-time view of the automation browser
					</p>
				</div>
			</div>
			<div className="flex-1 min-h-0">
				<VncViewer className="h-full" />
			</div>
		</div>
	)
}
