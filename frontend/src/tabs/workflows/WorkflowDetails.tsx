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
		<div className="p-6 space-y-6">
			{/* Header */}
			<div>
				<h3 className="text-lg font-semibold">{workflow.name}</h3>
				{workflow.description && (
					<p className="text-sm text-muted-foreground mt-1">{workflow.description}</p>
				)}
			</div>

			{/* Active Toggle & Schedule */}
			<>
				<div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
					<div className="flex items-center gap-3">
						<Switch
							checked={isActive}
							onCheckedChange={onToggleActive}
							disabled={!canToggleActive}
						/>
						<div>
							<p className="font-medium">{isActive ? 'Active' : 'Inactive'}</p>
							<p className="text-xs text-muted-foreground">
								{isActive ? 'Workflow is scheduled to run' : 'Workflow will not run automatically'}
							</p>
						</div>
					</div>
					{isRunning && (
						<Badge variant="default">Running</Badge>
					)}
				</div>

				{/* Schedule Info */}
				<div className="p-4 border rounded-lg space-y-3">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Clock className="h-4 w-4 text-muted-foreground" />
							<span className="font-medium">Schedule</span>
						</div>
						<Button size="sm" variant="outline" onClick={onEditSchedule}>
							<Settings2 className="h-4 w-4 mr-1" />
							{hasSchedule ? 'Edit' : 'Configure'}
						</Button>
					</div>
					<div className="text-sm">
						{hasSchedule ? (
							<>
								<p>{formatSchedule(workflow.scheduleType, workflow.scheduleConfig as ScheduleConfig)}</p>
								{workflow.maxRunsPerDay && (
									<p className="text-muted-foreground mt-1">
										Limit: {workflow.runsToday ?? 0}/{workflow.maxRunsPerDay} runs today
									</p>
								)}
							</>
						) : (
							<p className="text-muted-foreground">No schedule configured</p>
						)}
					</div>
				</div>

				{/* Status */}
				{status && status !== 'idle' && (
					<div className="flex items-center gap-3">
						<Badge variant={getStatusColor(status)} className="text-sm">
							{getStatusLabel(status)}
						</Badge>
					</div>
				)}

				{/* Actions */}
				<div className="flex flex-wrap gap-2">
					{isRunning && (
						<Button size="sm" variant="destructive" onClick={onStopRun}>
							<Square className="mr-2 h-4 w-4" />
							Stop
						</Button>
					)}
					{(isCompleted || isFailed || status === 'cancelled') && (
						<Button size="sm" variant="outline" onClick={onReset}>
							<RefreshCw className="mr-2 h-4 w-4" />
							Reset
						</Button>
					)}
				</div>

				<Separator />
			</>

			{/* Info */}
			<div className="space-y-4">
				<div>
					<h4 className="text-sm font-medium text-muted-foreground mb-2">Information</h4>
					<dl className="space-y-2 text-sm">
						{workflow.category && (
							<div className="flex justify-between">
								<dt className="text-muted-foreground">Category</dt>
								<dd className="capitalize">{workflow.category}</dd>
							</div>
						)}
						<div className="flex justify-between">
							<dt className="text-muted-foreground">Nodes</dt>
							<dd>{Array.isArray(workflow.nodes) ? workflow.nodes.length : 0}</dd>
						</div>
						<div className="flex justify-between">
							<dt className="text-muted-foreground">Edges</dt>
							<dd>{Array.isArray(workflow.edges) ? workflow.edges.length : 0}</dd>
						</div>
					</dl>
				</div>

				<div>
					<h4 className="text-sm font-medium text-muted-foreground mb-2">Execution History</h4>
					<dl className="space-y-2 text-sm">
						{workflow.lastRunAt && (
							<div className="flex justify-between">
								<dt className="text-muted-foreground">Last Run</dt>
								<dd>{formatTimestamp(workflow.lastRunAt)}</dd>
							</div>
						)}
						{workflow.startedAt && (
							<div className="flex justify-between">
								<dt className="text-muted-foreground">Started</dt>
								<dd>{formatTimestamp(workflow.startedAt)}</dd>
							</div>
						)}
						{workflow.completedAt && (
							<div className="flex justify-between">
								<dt className="text-muted-foreground">Completed</dt>
								<dd>{formatTimestamp(workflow.completedAt)}</dd>
							</div>
						)}
						{workflow.startedAt && (
							<div className="flex justify-between">
								<dt className="text-muted-foreground">Duration</dt>
								<dd>{formatDuration(workflow.startedAt, workflow.completedAt)}</dd>
							</div>
						)}
						{workflow.runsToday !== undefined && workflow.runsToday > 0 && (
							<div className="flex justify-between">
								<dt className="text-muted-foreground">Runs Today</dt>
								<dd>{workflow.runsToday}</dd>
							</div>
						)}
					</dl>
				</div>

				{workflow.error && (
					<div>
						<h4 className="text-sm font-medium text-destructive mb-2">Error</h4>
						<p className="text-sm text-destructive/90 bg-destructive/10 p-3 rounded-md">
							{workflow.error}
						</p>
					</div>
				)}

				<div>
					<h4 className="text-sm font-medium text-muted-foreground mb-2">Timestamps</h4>
					<dl className="space-y-2 text-sm">
						<div className="flex justify-between">
							<dt className="text-muted-foreground">Created</dt>
							<dd>{formatTimestamp(workflow.createdAt)}</dd>
						</div>
						<div className="flex justify-between">
							<dt className="text-muted-foreground">Updated</dt>
							<dd>{formatTimestamp(workflow.updatedAt)}</dd>
						</div>
					</dl>
				</div>
			</div>
		</div>
	)
}
