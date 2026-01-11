import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Trash2, RefreshCw, AlertCircle, CheckCircle, Info, AlertTriangle, Bug } from 'lucide-react'

interface WorkflowLogsDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	workflowId: Id<'workflows'> | null
	workflowName?: string
}

type LogLevel = 'info' | 'warn' | 'error' | 'success' | 'debug'

const levelConfig: Record<LogLevel, { icon: typeof Info; color: string; bgColor: string }> = {
	info: { icon: Info, color: 'text-blue-500', bgColor: 'bg-blue-500/10' },
	warn: { icon: AlertTriangle, color: 'text-yellow-500', bgColor: 'bg-yellow-500/10' },
	error: { icon: AlertCircle, color: 'text-red-500', bgColor: 'bg-red-500/10' },
	success: { icon: CheckCircle, color: 'text-green-500', bgColor: 'bg-green-500/10' },
	debug: { icon: Bug, color: 'text-gray-500', bgColor: 'bg-gray-500/10' },
}

function formatTime(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString('en-US', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	})
}

function formatDate(timestamp: number): string {
	return new Date(timestamp).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
	})
}

export function WorkflowLogsDialog({
	open,
	onOpenChange,
	workflowId,
	workflowName,
}: WorkflowLogsDialogProps) {
	const logs = useQuery(
		api.workflowLogs.list,
		workflowId ? { workflowId, limit: 200 } : 'skip'
	)
	const clearLogs = useMutation(api.workflowLogs.clearForWorkflow)

	const handleClear = async () => {
		if (!workflowId) return
		try {
			await clearLogs({ workflowId })
		} catch (e) {
			console.error('Failed to clear logs:', e)
		}
	}

	const isLoading = logs === undefined

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-3xl h-[600px] flex flex-col">
				<DialogHeader className="flex-none">
					<div className="flex items-center justify-between">
						<DialogTitle>
							Logs{workflowName ? `: ${workflowName}` : ''}
						</DialogTitle>
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={handleClear}
								disabled={!logs?.length}
							>
								<Trash2 className="h-4 w-4 mr-1" />
								Clear
							</Button>
						</div>
					</div>
				</DialogHeader>

				<ScrollArea className="flex-1 border rounded-lg">
					{isLoading ? (
						<div className="flex items-center justify-center h-full p-8">
							<RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
						</div>
					) : !logs?.length ? (
						<div className="flex flex-col items-center justify-center h-full p-8 text-muted-foreground">
							<Info className="h-12 w-12 mb-3 opacity-20" />
							<p>No logs available</p>
							<p className="text-sm">Logs will appear here when the workflow runs</p>
						</div>
					) : (
						<div className="p-2 space-y-1">
							{logs.map((log) => {
								const config = levelConfig[log.level as LogLevel] || levelConfig.info
								const Icon = config.icon

								return (
									<div
										key={log._id}
										className={`flex items-start gap-2 p-2 rounded text-sm ${config.bgColor}`}
									>
										<Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${config.color}`} />
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-2 mb-0.5">
												<Badge variant="outline" className="text-xs py-0">
													{log.level}
												</Badge>
												{log.nodeId && (
													<span className="text-xs text-muted-foreground">
														Node: {log.nodeId}
													</span>
												)}
												<span className="text-xs text-muted-foreground ml-auto">
													{formatDate(log.timestamp)} {formatTime(log.timestamp)}
												</span>
											</div>
											<p className="text-sm break-words">{log.message}</p>
											{log.metadata && (
												<pre className="mt-1 text-xs bg-background/50 p-1 rounded overflow-x-auto">
													{JSON.stringify(log.metadata, null, 2)}
												</pre>
											)}
										</div>
									</div>
								)
							})}
						</div>
					)}
				</ScrollArea>

				<div className="flex-none pt-2 flex items-center justify-between text-xs text-muted-foreground">
					<span>{logs?.length ?? 0} log entries</span>
					<span>Auto-refreshing</span>
				</div>
			</DialogContent>
		</Dialog>
	)
}
