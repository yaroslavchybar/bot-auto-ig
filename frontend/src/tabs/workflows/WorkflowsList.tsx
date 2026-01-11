import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
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
	FileText,
	Eye,
	GitBranch,
	Clock,
	Settings2,
} from 'lucide-react'
import type { Workflow } from './types'
import { formatTimestamp, formatSchedule } from './types'
import type { Id } from '../../../../convex/_generated/dataModel'

interface WorkflowsListProps {
	workflows: Workflow[]
	selectedId: Id<'workflows'> | null
	loading?: boolean
	onSelect: (workflow: Workflow) => void
	onToggleActive: (workflow: Workflow) => void
	onEdit: (workflow: Workflow) => void
	onEditFlow: (workflow: Workflow) => void
	onEditSchedule: (workflow: Workflow) => void
	onDuplicate: (workflow: Workflow) => void
	onDelete: (workflow: Workflow) => void
	onViewLogs: (workflow: Workflow) => void
	onViewDetails: (workflow: Workflow) => void
}

export function WorkflowsList({
	workflows,
	selectedId,
	loading,
	onSelect,
	onToggleActive,
	onEdit,
	onEditFlow,
	onEditSchedule,
	onDuplicate,
	onDelete,
	onViewLogs,
	onViewDetails,
}: WorkflowsListProps) {
	if (loading) {
		return (
			<div className="p-8 text-center text-muted-foreground">Loading workflows...</div>
		)
	}

	if (workflows.length === 0) {
		return (
			<div className="p-8 text-center text-muted-foreground">
				No workflows found. Create one to get started.
			</div>
		)
	}

	return (
		<div className="border rounded-lg overflow-hidden">
			<Table>
				<TableHeader>
					<TableRow className="bg-muted/50">
						<TableHead className="w-[80px]">Active</TableHead>
						<TableHead className="w-[250px]">Name</TableHead>
						<TableHead className="w-[100px]">Type</TableHead>
						<TableHead className="w-[200px]">Schedule</TableHead>
						<TableHead className="w-[150px]">Last Run</TableHead>
						<TableHead className="w-[100px] text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{workflows.map((workflow) => {
						const isTemplate = workflow.isTemplate
						const isActive = workflow.isActive ?? false
						const isRunning = workflow.status === 'running'
						const hasSchedule = !!workflow.scheduleType

						return (
							<TableRow
								key={workflow._id}
								className={`cursor-pointer transition-colors ${selectedId === workflow._id ? 'bg-muted' : 'hover:bg-muted/50'}`}
								onClick={() => onSelect(workflow)}
							>
								<TableCell onClick={(e) => e.stopPropagation()}>
									{!isTemplate && (
										<Switch
											checked={isActive}
											onCheckedChange={() => onToggleActive(workflow)}
											disabled={isRunning || !hasSchedule}
											title={!hasSchedule ? 'Configure schedule first' : isActive ? 'Deactivate' : 'Activate'}
										/>
									)}
								</TableCell>
								<TableCell className="font-medium">
									<div className="flex flex-col">
										<span>{workflow.name}</span>
										{workflow.description && (
											<span className="text-xs text-muted-foreground truncate max-w-[200px]">
												{workflow.description}
											</span>
										)}
									</div>
								</TableCell>
								<TableCell>
									<Badge variant={isTemplate ? 'outline' : 'secondary'}>
										{isTemplate ? 'Template' : 'Runnable'}
									</Badge>
								</TableCell>
								<TableCell>
									{!isTemplate && (
										<div className="flex items-center gap-2">
											{hasSchedule ? (
												<>
													<Clock className="h-4 w-4 text-muted-foreground" />
													<span className="text-sm">
														{formatSchedule(workflow.scheduleType, workflow.scheduleConfig)}
													</span>
													{workflow.maxRunsPerDay && (
														<Badge variant="outline" className="text-xs">
															{workflow.runsToday ?? 0}/{workflow.maxRunsPerDay}/day
														</Badge>
													)}
												</>
											) : (
												<Button
													variant="ghost"
													size="sm"
													className="h-7 text-xs text-muted-foreground"
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
									)}
								</TableCell>
								<TableCell className="text-sm text-muted-foreground">
									{formatTimestamp(workflow.lastRunAt)}
								</TableCell>
								<TableCell className="text-right">
									<div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
										{/* More menu */}
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" size="icon" className="h-8 w-8">
													<MoreHorizontal className="h-4 w-4" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem onClick={() => onViewDetails(workflow)}>
													<Eye className="mr-2 h-4 w-4" />
													View Details
												</DropdownMenuItem>
												{!isTemplate && (
													<>
														<DropdownMenuItem onClick={() => onViewLogs(workflow)}>
															<FileText className="mr-2 h-4 w-4" />
															View Logs
														</DropdownMenuItem>
														<DropdownMenuItem onClick={() => onEditSchedule(workflow)}>
															<Clock className="mr-2 h-4 w-4" />
															Edit Schedule
														</DropdownMenuItem>
													</>
												)}
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
												<DropdownMenuSeparator />
												<DropdownMenuItem
													onClick={() => onDelete(workflow)}
													disabled={isRunning}
													className="text-destructive focus:text-destructive"
												>
													<Trash2 className="mr-2 h-4 w-4" />
													Delete
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
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
