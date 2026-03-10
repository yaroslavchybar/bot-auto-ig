import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useIsMobile } from '@/hooks/use-mobile'
import { useState } from 'react'
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
import type { Workflow } from '../types'
import { formatTimestamp, formatSchedule, getStatusLabel } from '../types'

interface WorkflowsListProps {
  workflows: Workflow[]
  loading?: boolean
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
  const [open, setOpen] = useState(false)

  const handleEditFlowClick = () => {
    setOpen(false)
    window.requestAnimationFrame(() => onEditFlow(workflow))
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-copy hover:text-ink hover:bg-panel-muted data-[state=open]:bg-panel-muted data-[state=open]:text-ink h-8 w-8"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="panel-dropdown">
        {isRunning && (
          <>
            <DropdownMenuItem
              onClick={() => onStopRun(workflow)}
              className="text-status-danger focus:text-status-danger focus:bg-status-danger-soft cursor-pointer"
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
        <DropdownMenuItem
          onClick={handleEditFlowClick}
          disabled={isRunning}
        >
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
        <DropdownMenuItem
          onClick={() => onExport(workflow)}
          disabled={isRunning}
        >
          <Download className="mr-2 h-4 w-4" />
          Export JSON
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onDelete(workflow)}
          disabled={isRunning}
          className="text-status-danger focus:text-status-danger focus:bg-status-danger-soft cursor-pointer"
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
  loading,
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
      <div className="text-subtle-copy p-8 text-center">
        Loading workflows...
      </div>
    )
  }

  if (workflows.length === 0) {
    return (
      <div className="text-subtle-copy p-8 text-center">
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
          const scheduleLabel = formatSchedule(
            workflow.scheduleType,
            workflow.scheduleConfig,
            workflow.timezone,
          )
          const statusLabel = getStatusLabel(workflow.status)

          return (
            <div
              key={workflow._id}
              className="bg-panel-strong border-line hover:border-line-strong rounded-2xl border p-4 shadow-xs transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-inverse truncate text-base font-semibold">
                      {workflow.name}
                    </h3>
                    {workflow.status && workflow.status !== 'idle' && (
                      <Badge
                        variant="outline"
                        className={`shrink-0 border text-[10px] tracking-[0.18em] uppercase ${
                          isRunning
                            ? 'border-status-success-border bg-status-success-soft text-status-success'
                            : workflow.status === 'failed'
                              ? 'border-status-danger-border bg-status-danger-soft text-status-danger'
                              : 'border-line bg-panel-muted text-copy'
                        }`}
                      >
                        {statusLabel}
                      </Badge>
                    )}
                  </div>
                  <div className="text-muted-copy mt-2 flex items-center gap-2 text-xs">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{scheduleLabel}</span>
                  </div>
                  {workflow.description && (
                    <p className="text-subtle-copy mt-2 line-clamp-2 text-sm">
                      {workflow.description}
                    </p>
                  )}
                  {workflow.maxRunsPerDay && (
                    <div className="mt-3">
                      <Badge
                        variant="outline"
                        className="border-line text-muted-copy bg-transparent text-[10px]"
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

              <div className="border-line mt-4 border-t pt-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-subtle-copy text-[11px] font-semibold tracking-[0.18em] uppercase">
                      Last Run
                    </div>
                    <div className="text-copy mt-1 text-xs">
                      {formatTimestamp(workflow.lastRunAt)}
                    </div>
                  </div>
                  <div
                    className="flex items-center gap-2"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <span className="text-subtle-copy text-[10px] font-bold tracking-[0.18em] uppercase">
                      {isActive ? 'Active' : hasSchedule ? 'Paused' : 'Setup'}
                    </span>
                    <Switch
                      checked={isActive}
                      onCheckedChange={() => onToggleActive(workflow)}
                      disabled={!canToggleActive}
                      title={
                        !hasSchedule
                          ? 'Configure schedule first'
                          : isActive
                            ? 'Deactivate (will stop if running)'
                            : 'Activate'
                      }
                      className="brand-switch"
                    />
                  </div>
                </div>
                {!hasSchedule && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="brand-text-soft mt-3 h-8 px-0 text-xs hover:bg-transparent"
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
    <div className="bg-panel-subtle border-line-soft overflow-hidden rounded-2xl border backdrop-blur-xs">
      <Table>
        <TableHeader>
          <TableRow className="border-line-soft border-b hover:bg-transparent">
            <TableHead className="text-muted-copy w-[80px] font-medium">
              Active
            </TableHead>
            <TableHead className="text-muted-copy w-[250px] font-medium">
              Name
            </TableHead>
            <TableHead className="text-muted-copy w-[200px] font-medium">
              Schedule
            </TableHead>
            <TableHead className="text-muted-copy w-[150px] font-medium">
              Last Run
            </TableHead>
            <TableHead className="text-muted-copy w-[100px] text-right font-medium">
              Actions
            </TableHead>
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
                className="border-line-soft border-b transition-colors hover:bg-panel-subtle"
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Switch
                    checked={isActive}
                    onCheckedChange={() => onToggleActive(workflow)}
                    disabled={!canToggleActive}
                    title={
                      !hasSchedule
                        ? 'Configure schedule first'
                        : isActive
                          ? 'Deactivate (will stop if running)'
                          : 'Activate'
                    }
                    className="brand-switch"
                  />
                </TableCell>
                <TableCell className="font-medium">
                  <div className="flex flex-col">
                    <span className="text-ink">{workflow.name}</span>
                    {workflow.description && (
                      <span className="text-subtle-copy max-w-[200px] truncate text-xs">
                        {workflow.description}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {hasSchedule ? (
                      <>
                        <Clock className="text-subtle-copy h-4 w-4" />
                        <span className="text-copy text-sm">
                          {formatSchedule(
                            workflow.scheduleType,
                            workflow.scheduleConfig,
                            workflow.timezone,
                          )}
                        </span>
                        {workflow.maxRunsPerDay && (
                          <Badge
                            variant="outline"
                            className="border-line text-muted-copy bg-transparent text-xs"
                          >
                            {workflow.runsToday ?? 0}/{workflow.maxRunsPerDay}
                            /day
                          </Badge>
                        )}
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-copy hover:text-ink hover:bg-panel-muted h-7 text-xs"
                        onClick={(e) => {
                          e.stopPropagation()
                          onEditSchedule(workflow)
                        }}
                      >
                        <Settings2 className="mr-1 h-3 w-3" />
                        Configure
                      </Button>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-subtle-copy text-sm">
                  {formatTimestamp(workflow.lastRunAt)}
                </TableCell>
                <TableCell className="text-right">
                  <div
                    className="flex items-center justify-end gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
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



