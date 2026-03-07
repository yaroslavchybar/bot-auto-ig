import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Clock, RefreshCw, Settings2, Square } from 'lucide-react'
import type { Workflow, WorkflowStatus, ScheduleConfig } from './types'
import { getStatusColor, getStatusLabel, formatTimestamp, formatDuration, formatSchedule } from './types'

export interface WorkflowDetailsProps {
	workflow: Workflow
	onToggleActive?: () => void
	onEditSchedule?: () => void
	onReset?: () => void
	onStopRun?: () => void
}

export function WorkflowDetails({
	workflow,
	onToggleActive,
	onEditSchedule,
	onReset,
	onStopRun,
}: WorkflowDetailsProps) {
	const status = workflow.status as WorkflowStatus | undefined
	const isRunning = status === 'running'
	const isFailed = status === 'failed'
	const isCompleted = status === 'completed'
	const isActive = workflow.isActive ?? false
	const hasSchedule = !!workflow.scheduleType
	const canToggleActive = hasSchedule && (!isRunning || isActive)

	return (
		<div className="p-6 space-y-6 text-gray-200">
			{/* Header */}
			<div>
				<h3 className="text-lg font-semibold text-gray-200">{workflow.name}</h3>
				{workflow.description && (
					<p className="text-sm text-gray-500 mt-1">{workflow.description}</p>
				)}
			</div>

			{/* Active Toggle & Schedule */}
			<>
				<div className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-lg">
					<div className="flex items-center gap-3">
						<Switch
							checked={isActive}
							onCheckedChange={onToggleActive}
							disabled={!canToggleActive}
						/>
						<div>
							<p className="font-medium text-gray-200">{isActive ? 'Active' : 'Inactive'}</p>
							<p className="text-xs text-gray-500">
								{isActive ? 'Workflow is scheduled to run' : 'Workflow will not run automatically'}
							</p>
						</div>
					</div>
					{isRunning && (
						<Badge variant="default" className="bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20">Running</Badge>
					)}
				</div>

				{/* Schedule Info */}
				<div className="p-4 border border-white/5 bg-white/[0.02] rounded-lg space-y-3">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Clock className="h-4 w-4 text-gray-500" />
							<span className="font-medium text-gray-200">Schedule</span>
						</div>
						<Button size="sm" variant="outline" onClick={onEditSchedule} className="bg-transparent border-white/10 hover:bg-white/10 text-gray-300">
							<Settings2 className="h-4 w-4 mr-1" />
							{hasSchedule ? 'Edit' : 'Configure'}
						</Button>
					</div>
					<div className="text-sm text-gray-300">
						{hasSchedule ? (
							<>
								<p>{formatSchedule(workflow.scheduleType, workflow.scheduleConfig as ScheduleConfig, workflow.timezone)}</p>
								{workflow.maxRunsPerDay && (
									<p className="text-gray-500 mt-1">
										Limit: {workflow.runsToday ?? 0}/{workflow.maxRunsPerDay} runs today
									</p>
								)}
							</>
						) : (
							<p className="text-gray-500">No schedule configured</p>
						)}
					</div>
				</div>

				{/* Status */}
				{status && status !== 'idle' && (
					<div className="flex items-center gap-3">
						<Badge
							variant={getStatusColor(status)}
							className={`text-sm ${status === 'running' || status === 'completed' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
									status === 'failed' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
										status === 'cancelled' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' : ''
								}`}
						>
							{getStatusLabel(status)}
						</Badge>
					</div>
				)}

				{/* Actions */}
				<div className="flex flex-wrap gap-2">
					{isRunning && (
						<Button size="sm" variant="destructive" onClick={onStopRun} className="bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30">
							<Square className="mr-2 h-4 w-4" />
							Stop
						</Button>
					)}
					{(isCompleted || isFailed || status === 'cancelled') && (
						<Button size="sm" variant="outline" onClick={onReset} className="bg-transparent border-white/10 hover:bg-white/10 text-gray-300">
							<RefreshCw className="mr-2 h-4 w-4" />
							Reset
						</Button>
					)}
				</div>

				<Separator className="bg-white/5" />
			</>

			{/* Info */}
			<div className="space-y-4">
				<div>
					<h4 className="text-sm font-medium text-gray-400 mb-2">Information</h4>
					<dl className="space-y-2 text-sm">
						<div className="flex justify-between">
							<dt className="text-gray-500">Nodes</dt>
							<dd className="text-gray-200">{Array.isArray(workflow.nodes) ? workflow.nodes.length : 0}</dd>
						</div>
						<div className="flex justify-between">
							<dt className="text-gray-500">Edges</dt>
							<dd className="text-gray-200">{Array.isArray(workflow.edges) ? workflow.edges.length : 0}</dd>
						</div>
					</dl>
				</div>

				<div>
					<h4 className="text-sm font-medium text-gray-400 mb-2">Execution History</h4>
					<dl className="space-y-2 text-sm">
						{workflow.lastRunAt && (
							<div className="flex justify-between">
								<dt className="text-gray-500">Last Run</dt>
								<dd className="text-gray-200">{formatTimestamp(workflow.lastRunAt)}</dd>
							</div>
						)}
						{workflow.startedAt && (
							<div className="flex justify-between">
								<dt className="text-gray-500">Started</dt>
								<dd className="text-gray-200">{formatTimestamp(workflow.startedAt)}</dd>
							</div>
						)}
						{workflow.completedAt && (
							<div className="flex justify-between">
								<dt className="text-gray-500">Completed</dt>
								<dd className="text-gray-200">{formatTimestamp(workflow.completedAt)}</dd>
							</div>
						)}
						{workflow.startedAt && (
							<div className="flex justify-between">
								<dt className="text-gray-500">Duration</dt>
								<dd className="text-gray-200">{formatDuration(workflow.startedAt, workflow.completedAt)}</dd>
							</div>
						)}
						{workflow.runsToday !== undefined && workflow.runsToday > 0 && (
							<div className="flex justify-between">
								<dt className="text-gray-500">Runs Today</dt>
								<dd className="text-gray-200">{workflow.runsToday}</dd>
							</div>
						)}
					</dl>
				</div>

				{workflow.error && (
					<div>
						<h4 className="text-sm font-medium text-red-500 mb-2">Error</h4>
						<p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 p-3 rounded-md">
							{workflow.error}
						</p>
					</div>
				)}

				<div>
					<h4 className="text-sm font-medium text-gray-400 mb-2">Timestamps</h4>
					<dl className="space-y-2 text-sm">
						<div className="flex justify-between">
							<dt className="text-gray-500">Created</dt>
							<dd className="text-gray-200">{formatTimestamp(workflow.createdAt)}</dd>
						</div>
						<div className="flex justify-between">
							<dt className="text-gray-500">Updated</dt>
							<dd className="text-gray-200">{formatTimestamp(workflow.updatedAt)}</dd>
						</div>
					</dl>
				</div>
			</div>
		</div>
	)
}
