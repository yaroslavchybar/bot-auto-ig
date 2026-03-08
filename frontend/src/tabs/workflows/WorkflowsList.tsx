import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useIsMobile } from '@/hooks/use-mobile'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
	MoreHorizontal,
	Pencil,
	Trash2,
	Copy,
	Download,
	Eye,
	GitBranch,
	Clock,
	Settings2,
	Square,
} from 'lucide-react'
import type { Workflow } from './types'
import { formatTimestamp, formatSchedule, getStatusLabel } from './types'
import type { Id } from '../../../../convex/_generated/dataModel'

interface WorkflowsListProps {
	workflows: Workflow[]
	selectedId: Id<'workflows'> | null
	loading?: boolean
	onSelect: (workflow: Workflow) => void
	onToggleActive: (workflow: Workflow) => void
	onStopRun: (workflow: Workflow) => void
	onEdit: (workflow: Workflow) => void
	onEditFlow: (workflow: Workflow) => void
	onEditSchedule: (workflow: Workflow) => void
	onDuplicate: (workflow: Workflow) => void
	onExport: (workflow: Workflow) => void
	onDelete: (workflow: Workflow) => void
	onViewDetails: (workflow: Workflow) => void
}

interface WorkflowActionsMenuProps {
	workflow: Workflow
	isRunning: boolean
	onStopRun: (workflow: Workflow) => void
	onViewDetails: (workflow: Workflow) => void
	onEditSchedule: (workflow: Workflow) => void
	onEditFlow: (workflow: Workflow) => void
	onEdit: (workflow: Workflow) => void
	onDuplicate: (workflow: Workflow) => void
	onExport: (workflow: Workflow) => void
	onDelete: (workflow: Workflow) => void
}

function WorkflowActionsMenu({
	workflow,
	isRunning,
	onStopRun,
	onViewDetails,
	onEditSchedule,
	onEditFlow,
	onEdit,
	onDuplicate,
	onExport,
	onDelete,
}: WorkflowActionsMenuProps) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8 text-gray-400 hover:text-gray-200 hover:bg-white/5 data-[state=open]:bg-white/5 data-[state=open]:text-gray-200"
				>
					<MoreHorizontal className="h-4 w-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="bg-[#0f0f0f] border-white/10 text-gray-300">
				{isRunning && (
					<>
						<DropdownMenuItem
							onClick={() => onStopRun(workflow)}
							className="text-red-400 focus:text-red-300 focus:bg-red-500/10 cursor-pointer"
						>
							<Square className="mr-2 h-4 w-4" />
							Stop Run
						</DropdownMenuItem>
						<DropdownMenuSeparator />
					</>
				)}
				<DropdownMenuItem onClick={() => onViewDetails(workflow)}>
					<Eye className="mr-2 h-4 w-4" />
					View Details
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => onEditSchedule(workflow)}>
					<Clock className="mr-2 h-4 w-4" />
					Edit Schedule
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={() => onEditFlow(workflow)} disabled={isRunning}>
					<GitBranch className="mr-2 h-4 w-4" />
					Edit Flow
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => onEdit(workflow)} disabled={isRunning}>
					<Pencil className="mr-2 h-4 w-4" />
					Edit Details
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => onDuplicate(workflow)}>
					<Copy className="mr-2 h-4 w-4" />
					Duplicate
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => onExport(workflow)} disabled={isRunning}>
					<Download className="mr-2 h-4 w-4" />
					Export JSON
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onClick={() => onDelete(workflow)}
					disabled={isRunning}
					className="text-red-400 focus:text-red-300 focus:bg-red-500/10 cursor-pointer"
				>
					<Trash2 className="mr-2 h-4 w-4" />
					Delete
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

export function WorkflowsList({
	workflows,
	selectedId,
	loading,
	onSelect,
	onToggleActive,
	onStopRun,
	onEdit,
	onEditFlow,
	onEditSchedule,
	onDuplicate,
	onExport,
	onDelete,
	onViewDetails,
}: WorkflowsListProps) {
	const isMobile = useIsMobile()

	if (loading) {
		return (
			<div className="p-8 text-center text-gray-500">Loading workflows...</div>
		)
	}

	if (workflows.length === 0) {
		return (
			<div className="p-8 text-center text-gray-500">
				No workflows found. Create one to get started.
			</div>
		)
	}

	if (isMobile) {
		return (
			<div className="space-y-4">
				{workflows.map((workflow) => {
					const isActive = workflow.isActive ?? false
					const isRunning = workflow.status === 'running'
					const hasSchedule = !!workflow.scheduleType
					const canToggleActive = hasSchedule && (!isRunning || isActive)
					const scheduleLabel = formatSchedule(workflow.scheduleType, workflow.scheduleConfig, workflow.timezone)
					const statusLabel = getStatusLabel(workflow.status)

					return (
						<div
							key={workflow._id}
							className={`rounded-2xl border bg-[#141414] p-4 shadow-xs transition-colors ${
								selectedId === workflow._id
									? 'border-orange-500/60 bg-white/[0.04]'
									: 'border-white/10 hover:border-white/20'
							}`}
							onClick={() => onSelect(workflow)}
						>
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<h3 className="truncate text-base font-semibold text-gray-100">
											{workflow.name}
										</h3>
										{workflow.status && workflow.status !== 'idle' && (
											<Badge
												variant="outline"
												className={`shrink-0 border text-[10px] uppercase tracking-[0.18em] ${
													isRunning
														? 'border-green-500/30 bg-green-500/10 text-green-300'
														: workflow.status === 'failed'
															? 'border-red-500/30 bg-red-500/10 text-red-300'
															: 'border-white/10 bg-white/5 text-gray-300'
												}`}
											>
												{statusLabel}
											</Badge>
										)}
									</div>
									<div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
										<Clock className="h-3.5 w-3.5 shrink-0" />
										<span className="truncate">{scheduleLabel}</span>
									</div>
									{workflow.description && (
										<p className="mt-2 text-sm text-gray-500 line-clamp-2">
											{workflow.description}
										</p>
									)}
									{workflow.maxRunsPerDay && (
										<div className="mt-3">
											<Badge
												variant="outline"
												className="bg-transparent border-white/10 text-[10px] text-gray-400"
											>
												{workflow.runsToday ?? 0}/{workflow.maxRunsPerDay}/day
											</Badge>
										</div>
									)}
								</div>
								<div onClick={(event) => event.stopPropagation()}>
									<WorkflowActionsMenu
										workflow={workflow}
										isRunning={isRunning}
										onStopRun={onStopRun}
										onViewDetails={onViewDetails}
										onEditSchedule={onEditSchedule}
										onEditFlow={onEditFlow}
										onEdit={onEdit}
										onDuplicate={onDuplicate}
										onExport={onExport}
										onDelete={onDelete}
									/>
								</div>
							</div>

							<div className="mt-4 border-t border-white/10 pt-3">
								<div className="flex items-center justify-between gap-3">
									<div className="min-w-0">
										<div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
											Last Run
										</div>
										<div className="mt-1 text-xs text-gray-300">
											{formatTimestamp(workflow.lastRunAt)}
										</div>
									</div>
									<div
										className="flex items-center gap-2"
										onClick={(event) => event.stopPropagation()}
									>
										<span className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">
											{isActive ? 'Active' : hasSchedule ? 'Paused' : 'Setup'}
										</span>
										<Switch
											checked={isActive}
											onCheckedChange={() => onToggleActive(workflow)}
											disabled={!canToggleActive}
											title={!hasSchedule ? 'Configure schedule first' : isActive ? 'Deactivate (will stop if running)' : 'Activate'}
											className="data-[state=checked]:bg-orange-500 data-[state=unchecked]:bg-gray-700"
										/>
									</div>
								</div>
								{!hasSchedule && (
									<Button
										variant="ghost"
										size="sm"
										className="mt-3 h-8 px-0 text-xs text-orange-300 hover:text-orange-200 hover:bg-transparent"
										onClick={(event) => {
											event.stopPropagation()
											onEditSchedule(workflow)
										}}
									>
										<Settings2 className="h-3.5 w-3.5" />
										Configure schedule
									</Button>
								)}
							</div>
						</div>
					)
				})}
			</div>
		)
	}

	return (
		<div className="bg-white/[0.02] rounded-2xl backdrop-blur-xs border border-white/[0.05] overflow-hidden">
			<Table>
				<TableHeader>
					<TableRow className="border-b border-white/[0.05] hover:bg-transparent">
						<TableHead className="w-[80px] text-gray-400 font-medium">Active</TableHead>
						<TableHead className="w-[250px] text-gray-400 font-medium">Name</TableHead>
						<TableHead className="w-[200px] text-gray-400 font-medium">Schedule</TableHead>
						<TableHead className="w-[150px] text-gray-400 font-medium">Last Run</TableHead>
						<TableHead className="w-[100px] text-right text-gray-400 font-medium">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{workflows.map((workflow) => {
						const isActive = workflow.isActive ?? false
						const isRunning = workflow.status === 'running'
						const hasSchedule = !!workflow.scheduleType
						const canToggleActive = hasSchedule && (!isRunning || isActive)

						return (
							<TableRow
								key={workflow._id}
								className={`cursor-pointer transition-colors border-b border-white/[0.05] ${selectedId === workflow._id ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'}`}
								onClick={() => onSelect(workflow)}
							>
								<TableCell onClick={(e) => e.stopPropagation()}>
									<Switch
										checked={isActive}
										onCheckedChange={() => onToggleActive(workflow)}
										disabled={!canToggleActive}
										title={!hasSchedule ? 'Configure schedule first' : isActive ? 'Deactivate (will stop if running)' : 'Activate'}
									/>
								</TableCell>
								<TableCell className="font-medium">
									<div className="flex flex-col">
										<span className="text-gray-200">{workflow.name}</span>
										{workflow.description && (
											<span className="text-xs text-gray-500 truncate max-w-[200px]">
												{workflow.description}
											</span>
										)}
									</div>
								</TableCell>
								<TableCell>
									<div className="flex items-center gap-2">
										{hasSchedule ? (
											<>
												<Clock className="h-4 w-4 text-gray-500" />
												<span className="text-sm text-gray-300">
													{formatSchedule(workflow.scheduleType, workflow.scheduleConfig, workflow.timezone)}
												</span>
												{workflow.maxRunsPerDay && (
													<Badge variant="outline" className="text-xs bg-transparent border-white/10 text-gray-400">
														{workflow.runsToday ?? 0}/{workflow.maxRunsPerDay}/day
													</Badge>
												)}
											</>
										) : (
											<Button
												variant="ghost"
												size="sm"
												className="h-7 text-xs text-gray-400 hover:text-gray-200 hover:bg-white/5"
												onClick={(e) => {
													e.stopPropagation()
													onEditSchedule(workflow)
												}}
											>
												<Settings2 className="h-3 w-3 mr-1" />
												Configure
											</Button>
										)}
									</div>
								</TableCell>
								<TableCell className="text-sm text-gray-500">
									{formatTimestamp(workflow.lastRunAt)}
								</TableCell>
								<TableCell className="text-right">
									<div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
										<WorkflowActionsMenu
											workflow={workflow}
											isRunning={isRunning}
											onStopRun={onStopRun}
											onViewDetails={onViewDetails}
											onEditSchedule={onEditSchedule}
											onEditFlow={onEditFlow}
											onEdit={onEdit}
											onDuplicate={onDuplicate}
											onExport={onExport}
											onDelete={onDelete}
										/>
									</div>
								</TableCell>
							</TableRow>
						)
					})}
				</TableBody>
			</Table>
		</div>
	)
}
