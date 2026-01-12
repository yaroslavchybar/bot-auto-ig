import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Plus, RefreshCw, Trash2, User, Activity, Wifi, WifiOff } from 'lucide-react'
import { useWebSocket } from '@/hooks/useWebSocket'
import { apiFetch } from '@/lib/api'
import { WorkflowsList } from './WorkflowsList'
import { WorkflowDialog } from './WorkflowDialog'
import { WorkflowDetails } from './WorkflowDetails'
import { WorkflowFlowEditor } from './WorkflowFlowEditor'
import { ScheduleDialog } from './ScheduleDialog'
import type { Workflow } from './types'
import type { Node, Edge } from 'reactflow'

export function WorkflowsPage() {
	const [selectedId, setSelectedId] = useState<Id<'workflows'> | null>(null)
	const [isCreateOpen, setIsCreateOpen] = useState(false)
	const [isEditOpen, setIsEditOpen] = useState(false)
	const [isDetailsOpen, setIsDetailsOpen] = useState(false)
	const [isFlowEditorOpen, setIsFlowEditorOpen] = useState(false)
	const [isScheduleOpen, setIsScheduleOpen] = useState(false)
	const [deleteId, setDeleteId] = useState<Id<'workflows'> | null>(null)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)

	// WebSocket for live logs and progress
	const { logs, status, progress, clearLogs, connected } = useWebSocket()

	// Queries
	const workflows = useQuery(api.workflows.list, {})
	const workflowsLoading = workflows === undefined
	const workflowsList = useMemo(() => workflows ?? [], [workflows])

	// Mutations
	const createWorkflow = useMutation(api.workflows.create)
	const updateWorkflow = useMutation(api.workflows.update)
	const removeWorkflow = useMutation(api.workflows.remove)
	const duplicateWorkflow = useMutation(api.workflows.duplicate)
	const toggleActiveWorkflow = useMutation(api.workflows.toggleActive)
	const updateSchedule = useMutation(api.workflows.updateSchedule)
	const resetWorkflow = useMutation(api.workflows.reset)

	const selected = useMemo(
		() => workflowsList.find((w) => w._id === selectedId) ?? null,
		[workflowsList, selectedId]
	)

	// Handlers
	const handleSelect = useCallback((workflow: Workflow) => {
		setSelectedId(workflow._id)
		setError(null)
	}, [])

	const handleCreate = useCallback(() => {
		setIsCreateOpen(true)
		setError(null)
	}, [])

	const handleEdit = useCallback((workflow: Workflow) => {
		setSelectedId(workflow._id)
		setIsEditOpen(true)
		setError(null)
	}, [])

	const handleViewDetails = useCallback((workflow: Workflow) => {
		setSelectedId(workflow._id)
		setIsDetailsOpen(true)
		setError(null)
	}, [])

	const handleEditFlow = useCallback((workflow: Workflow) => {
		setSelectedId(workflow._id)
		setIsFlowEditorOpen(true)
		setError(null)
	}, [])

	const handleSaveCreate = useCallback(
		async (data: { name: string; description?: string; category?: string }) => {
			setSaving(true)
			setError(null)
			try {
				const created = await createWorkflow({
					name: data.name,
					description: data.description,
					category: data.category,
					nodes: [],
					edges: [],
				})
				if (created?._id) setSelectedId(created._id)
				setIsCreateOpen(false)
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e))
			} finally {
				setSaving(false)
			}
		},
		[createWorkflow]
	)

	const handleSaveEdit = useCallback(
		async (data: { name: string; description?: string; category?: string }) => {
			if (!selectedId) return
			setSaving(true)
			setError(null)
			try {
				await updateWorkflow({
					id: selectedId,
					name: data.name,
					description: data.description,
					category: data.category,
				})
				setIsEditOpen(false)
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e))
			} finally {
				setSaving(false)
			}
		},
		[selectedId, updateWorkflow]
	)

	const handleDelete = useCallback((workflow: Workflow) => {
		setDeleteId(workflow._id)
	}, [])

	const handleConfirmDelete = useCallback(async () => {
		if (!deleteId) return
		setSaving(true)
		setError(null)
		try {
			await removeWorkflow({ id: deleteId })
			if (selectedId === deleteId) setSelectedId(null)
			setDeleteId(null)
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setSaving(false)
		}
	}, [deleteId, removeWorkflow, selectedId])

	const handleDuplicate = useCallback(
		async (workflow: Workflow) => {
			setSaving(true)
			setError(null)
			try {
				const duplicated = await duplicateWorkflow({ id: workflow._id })
				if (duplicated?._id) setSelectedId(duplicated._id)
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e))
			} finally {
				setSaving(false)
			}
		},
		[duplicateWorkflow]
	)

	const handleToggleActive = useCallback(
		async (workflow: Workflow) => {
			setError(null)
			try {
				if (workflow.isActive && workflow.status === 'running') {
					try {
						await apiFetch('/api/workflows/stop', { method: 'POST', body: { workflowId: workflow._id } })
					} catch (e) {
						void e
					}
				}
				await toggleActiveWorkflow({ id: workflow._id })
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e))
			}
		},
		[toggleActiveWorkflow]
	)

	const handleStopRun = useCallback(async (workflow: Workflow) => {
		setError(null)
		try {
			await apiFetch('/api/workflows/stop', { method: 'POST', body: { workflowId: workflow._id } })
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		}
	}, [])

	const handleEditSchedule = useCallback((workflow: Workflow) => {
		setSelectedId(workflow._id)
		setIsScheduleOpen(true)
		setError(null)
	}, [])

	const handleSaveSchedule = useCallback(
		async (data: {
			scheduleType: 'interval' | 'daily' | 'weekly' | 'monthly' | 'cron'
			scheduleConfig: {
				intervalMs?: number
				hourUTC?: number
				minuteUTC?: number
				daysOfWeek?: number[]
				dayOfMonth?: number
				cronspec?: string
			}
			maxRunsPerDay?: number
			timezone?: string
		}) => {
			if (!selectedId) return
			setSaving(true)
			setError(null)
			try {
				await updateSchedule({
					id: selectedId,
					scheduleType: data.scheduleType,
					scheduleConfig: data.scheduleConfig,
					maxRunsPerDay: data.maxRunsPerDay,
					timezone: data.timezone,
				})
				setIsScheduleOpen(false)
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e))
			} finally {
				setSaving(false)
			}
		},
		[selectedId, updateSchedule]
	)

	const handleReset = useCallback(async () => {
		if (!selectedId) return
		setError(null)
		try {
			await resetWorkflow({ id: selectedId })
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		}
	}, [selectedId, resetWorkflow])

	const handleSaveFlow = useCallback(
		async (nodes: Node[], edges: Edge[]) => {
			if (!selectedId) return
			setSaving(true)
			setError(null)
			try {
				const serializableNodes = nodes as unknown as Array<Record<string, unknown>>
				const serializableEdges = edges as unknown as Array<Record<string, unknown>>
				await updateWorkflow({
					id: selectedId,
					nodes: serializableNodes,
					edges: serializableEdges,
				})
				setIsFlowEditorOpen(false)
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e))
			} finally {
				setSaving(false)
			}
		},
		[selectedId, updateWorkflow]
	)

	return (
		<div className="flex flex-col h-full bg-background">
			{/* Header */}
			<div className="flex items-center justify-between p-4 border-b flex-none">
				<div>
					<h2 className="text-2xl font-bold tracking-tight">Workflows</h2>
					<p className="text-sm text-muted-foreground">
						Create and manage automation workflows
					</p>
				</div>
				<div className="flex items-center gap-2">
					{/* Connection status */}
					<div className="flex items-center gap-1 text-sm text-muted-foreground">
						{connected ? (
							<Wifi className="h-4 w-4 text-green-500" />
						) : (
							<WifiOff className="h-4 w-4 text-muted-foreground" />
						)}
					</div>
					<Button
						variant="outline"
						size="sm"
						disabled={workflowsLoading || saving}
					>
						<RefreshCw className={`mr-2 h-4 w-4 ${workflowsLoading ? 'animate-spin' : ''}`} />
						Refresh
					</Button>
					<Button size="sm" onClick={handleCreate} disabled={saving}>
						<Plus className="mr-2 h-4 w-4" />
						New Workflow
					</Button>
				</div>
			</div>

			{/* Error */}
			{error && (
				<div className="p-4 bg-destructive/10 text-destructive text-sm border-b border-destructive/20 flex-none">
					{error}
				</div>
			)}

			{/* Main content area */}
			<div className="flex-1 flex flex-col min-h-0 overflow-hidden">
				{/* Workflows list */}
				<div className="flex-1 overflow-auto p-4">
					<WorkflowsList
						workflows={workflowsList}
						selectedId={selectedId}
						loading={workflowsLoading}
						onSelect={handleSelect}
						onToggleActive={handleToggleActive}
						onStopRun={handleStopRun}
						onEdit={handleEdit}
						onEditFlow={handleEditFlow}
						onEditSchedule={handleEditSchedule}
						onDuplicate={handleDuplicate}
						onDelete={handleDelete}
						onViewDetails={handleViewDetails}
					/>
				</div>

				{/* Live status panel */}
				<div className="flex-none border-t p-4">
					<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
						{/* Progress tracking */}
						<Card>
							<CardHeader className="p-3 pb-1">
								<CardTitle className="text-sm font-medium flex items-center gap-2">
									Progress
									{status === 'running' && (
										<span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
									)}
								</CardTitle>
							</CardHeader>
							<CardContent className="p-3 pt-0">
								{status === 'running' ? (
									<div className="space-y-2">
										{progress.currentProfile && (
											<div className="flex items-center gap-2 text-sm">
												<User className="h-4 w-4 text-muted-foreground" />
												<span className="text-muted-foreground">Profile:</span>
												<span className="font-medium">{progress.currentProfile}</span>
											</div>
										)}
										{progress.currentTask && (
											<div className="flex items-center gap-2 text-sm">
												<Activity className="h-4 w-4 text-muted-foreground" />
												<span className="text-muted-foreground">Task:</span>
												<span>{progress.currentTask}</span>
											</div>
										)}
										{!progress.currentProfile && !progress.currentTask && (
											<p className="text-sm text-muted-foreground">Starting...</p>
										)}
									</div>
								) : (
									<p className="text-sm text-muted-foreground">
										{status === 'idle' ? 'No workflow running' : 'Stopping...'}
									</p>
								)}
							</CardContent>
						</Card>

						{/* Live logs */}
						<Card>
							<CardHeader className="p-3 pb-1">
								<div className="flex items-center justify-between">
									<CardTitle className="text-sm font-medium">Live Logs</CardTitle>
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7"
										onClick={clearLogs}
										disabled={logs.length === 0}
									>
										<Trash2 className="h-4 w-4" />
									</Button>
								</div>
							</CardHeader>
							<CardContent className="p-3 pt-0">
								<ScrollArea className="h-24">
									{logs.length === 0 ? (
										<p className="text-sm text-muted-foreground">No logs yet</p>
									) : (
										<div className="space-y-1">
											{logs.slice(-10).map((log, index) => (
												<div
													key={`${log.ts}-${index}`}
													className={`text-xs font-mono ${
														log.level === 'error' ? 'text-red-500' :
														log.level === 'warn' ? 'text-yellow-500' :
														log.level === 'success' ? 'text-green-500' :
														'text-muted-foreground'
													}`}
												>
													<span className="text-muted-foreground">
														[{new Date(log.ts).toLocaleTimeString('en-US', { hour12: false })}]
													</span>
													{' '}{log.message}
												</div>
											))}
										</div>
									)}
								</ScrollArea>
							</CardContent>
						</Card>
					</div>
				</div>
			</div>

			{/* Create Dialog */}
			<WorkflowDialog
				open={isCreateOpen}
				onOpenChange={setIsCreateOpen}
				mode="create"
				saving={saving}
				onSave={handleSaveCreate}
				onCancel={() => setIsCreateOpen(false)}
			/>

			{/* Edit Dialog */}
			<WorkflowDialog
				open={isEditOpen}
				onOpenChange={setIsEditOpen}
				mode="edit"
				workflow={selected}
				saving={saving}
				onSave={handleSaveEdit}
				onCancel={() => setIsEditOpen(false)}
			/>

			{/* Details Sheet */}
			<Sheet open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
				<SheetContent className="w-[400px] sm:w-[540px] p-0">
					<SheetHeader className="p-6 pb-4 border-b">
						<SheetTitle>Workflow Details</SheetTitle>
					</SheetHeader>
					{selected ? (
						<WorkflowDetails
							workflow={selected}
							onToggleActive={() => handleToggleActive(selected)}
							onEditSchedule={() => handleEditSchedule(selected)}
							onReset={handleReset}
							onStopRun={() => handleStopRun(selected)}
						/>
					) : (
						<div className="p-8 text-center text-muted-foreground">
							No workflow selected
						</div>
					)}
				</SheetContent>
			</Sheet>

			{/* Delete Confirmation */}
			<AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Workflow</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete this workflow? This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleConfirmDelete}
							disabled={saving}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{saving ? 'Deleting...' : 'Delete'}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Flow Editor */}
			<WorkflowFlowEditor
				open={isFlowEditorOpen}
				workflow={selected}
				saving={saving}
				onSave={handleSaveFlow}
				onClose={() => setIsFlowEditorOpen(false)}
			/>

			{/* Schedule Dialog */}
			<ScheduleDialog
				open={isScheduleOpen}
				onOpenChange={setIsScheduleOpen}
				workflow={selected}
				saving={saving}
				onSave={handleSaveSchedule}
			/>
		</div>
	)
}
