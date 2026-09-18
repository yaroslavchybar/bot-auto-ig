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
  Play,
  Square,
} from 'lucide-react'
import type { Automation } from '../types'
import { formatTimestamp, getStatusColor, getStatusLabel } from '../types'

interface AutomationsListProps {
  automations: Automation[]
  loading?: boolean
  onToggleActive: (automation: Automation) => void
  onRun: (automation: Automation) => void
  onStopRun: (automation: Automation) => void
  onEdit: (automation: Automation) => void
  onEditFlow: (automation: Automation) => void
  onDuplicate: (automation: Automation) => void
  onExport: (automation: Automation) => void
  onDelete: (automation: Automation) => void
  onViewDetails: (automation: Automation) => void
}

interface AutomationActionsMenuProps {
  automation: Automation
  isRunning: boolean
  canRun: boolean
  onRun: (automation: Automation) => void
  onStopRun: (automation: Automation) => void
  onViewDetails: (automation: Automation) => void
  onEditFlow: (automation: Automation) => void
  onEdit: (automation: Automation) => void
  onDuplicate: (automation: Automation) => void
  onExport: (automation: Automation) => void
  onDelete: (automation: Automation) => void
}

/* ── Actions menu items ── */

function ActionsMenuItems({
  automation,
  isRunning,
  canRun,
  onRun,
  onStopRun,
  onViewDetails,
  onEditFlow,
  onEdit,
  onDuplicate,
  onExport,
  onDelete,
}: AutomationActionsMenuProps) {
  return (
    <>
      {isRunning ? (
        <>
          <DropdownMenuItem
            onClick={() => onStopRun(automation)}
            className="text-status-danger focus:text-status-danger focus:bg-status-danger-soft cursor-pointer"
          >
            <Square className="mr-2 h-4 w-4" />
            Stop Run
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      ) : (
        <>
          <DropdownMenuItem
            onClick={() => onRun(automation)}
            disabled={!canRun}
            title={!canRun ? 'Enable the automation to run it' : undefined}
          >
            <Play className="mr-2 h-4 w-4" />
            Run
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem onClick={() => onViewDetails(automation)}>
        <Eye className="mr-2 h-4 w-4" />
        View Details
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => onEditFlow(automation)} disabled={isRunning}>
        <GitBranch className="mr-2 h-4 w-4" />
        Edit Flow
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => onEdit(automation)} disabled={isRunning}>
        <Pencil className="mr-2 h-4 w-4" />
        Edit Details
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => onDuplicate(automation)}>
        <Copy className="mr-2 h-4 w-4" />
        Duplicate
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => onExport(automation)}
        disabled={isRunning}
      >
        <Download className="mr-2 h-4 w-4" />
        Export JSON
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={() => onDelete(automation)}
        disabled={isRunning}
        className="text-status-danger focus:text-status-danger focus:bg-status-danger-soft cursor-pointer"
      >
        <Trash2 className="mr-2 h-4 w-4" />
        Delete
      </DropdownMenuItem>
    </>
  )
}

function AutomationActionsMenu(props: AutomationActionsMenuProps) {
  const [open, setOpen] = useState(false)

  const handleEditFlowClick = () => {
    setOpen(false)
    window.requestAnimationFrame(() => props.onEditFlow(props.automation))
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Actions for ${props.automation.name}`}
          className="text-muted-copy hover:text-ink hover:bg-panel-muted data-[state=open]:bg-panel-muted data-[state=open]:text-ink h-8 w-8"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="panel-dropdown">
        <ActionsMenuItems
          {...props}
          onEditFlow={handleEditFlowClick}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* ── Mobile automation card ── */

function AutomationMobileCard({
  automation,
  onToggleActive,
  onRun,
  ...menuProps
}: {
  automation: Automation
  onToggleActive: (automation: Automation) => void
  onRun: (automation: Automation) => void
  onStopRun: (automation: Automation) => void
  onViewDetails: (automation: Automation) => void
  onEditFlow: (automation: Automation) => void
  onEdit: (automation: Automation) => void
  onDuplicate: (automation: Automation) => void
  onExport: (automation: Automation) => void
  onDelete: (automation: Automation) => void
}) {
  const isActive = automation.isActive ?? true
  const isRunning = automation.status === 'running'
  const canRun = isActive && !isRunning && automation.status !== 'pending'
  const statusLabel = getStatusLabel(automation.status)

  return (
    <div className="bg-panel-strong border-line hover:border-line-strong rounded-2xl border p-4 shadow-xs transition-colors">
      <MobileCardHeader
        automation={automation}
        isRunning={isRunning}
        statusLabel={statusLabel}
        menuProps={{ ...menuProps, automation, isRunning, canRun, onRun }}
      />
      <MobileCardFooter
        automation={automation}
        isActive={isActive}
        onToggleActive={onToggleActive}
      />
    </div>
  )
}

/* ── Mobile card header ── */

function MobileCardHeader({
  automation,
  isRunning,
  statusLabel,
  menuProps,
}: {
  automation: Automation
  isRunning: boolean
  statusLabel: string
  menuProps: AutomationActionsMenuProps
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-ink truncate text-base font-semibold">
            {automation.name}
          </h3>
          {automation.status && automation.status !== 'idle' && (
            <Badge
              variant="outline"
              className={`shrink-0 border text-[10px] tracking-[0.18em] uppercase ${
                isRunning
                  ? 'border-status-success-border bg-status-success-soft text-status-success'
                  : automation.status === 'failed'
                    ? 'border-status-danger-border bg-status-danger-soft text-status-danger'
                    : 'border-line bg-panel-muted text-copy'
              }`}
            >
              {statusLabel}
            </Badge>
          )}
        </div>
        {automation.description && (
          <p className="text-subtle-copy mt-2 line-clamp-2 text-sm">
            {automation.description}
          </p>
        )}
      </div>
      <div onClick={(event) => event.stopPropagation()}>
        <AutomationActionsMenu {...menuProps} />
      </div>
    </div>
  )
}

/* ── Mobile card footer ── */

function MobileCardFooter({
  automation,
  isActive,
  onToggleActive,
}: {
  automation: Automation
  isActive: boolean
  onToggleActive: (automation: Automation) => void
}) {
  return (
    <div className="border-line mt-4 border-t pt-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-subtle-copy text-[11px] font-semibold tracking-[0.18em] uppercase">
            Last Run
          </div>
          <div className="text-copy mt-1 text-xs">
            {formatTimestamp(automation.lastRunAt)}
          </div>
        </div>
        <div
          className="flex items-center gap-2"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="text-subtle-copy text-[10px] font-bold tracking-[0.18em] uppercase">
            {isActive ? 'Active' : 'Disabled'}
          </span>
          <Switch
            checked={isActive}
            onCheckedChange={() => onToggleActive(automation)}
            title={isActive ? 'Disable' : 'Enable'}
            className="brand-switch"
          />
        </div>
      </div>
    </div>
  )
}

/* ── Desktop table row ── */

function AutomationDesktopRow({
  automation,
  onToggleActive,
  onRun,
  ...menuProps
}: {
  automation: Automation
  onToggleActive: (automation: Automation) => void
  onRun: (automation: Automation) => void
  onStopRun: (automation: Automation) => void
  onViewDetails: (automation: Automation) => void
  onEditFlow: (automation: Automation) => void
  onEdit: (automation: Automation) => void
  onDuplicate: (automation: Automation) => void
  onExport: (automation: Automation) => void
  onDelete: (automation: Automation) => void
}) {
  const isActive = automation.isActive ?? true
  const isRunning = automation.status === 'running'
  const canRun = isActive && !isRunning && automation.status !== 'pending'

  return (
    <TableRow className="border-line-soft border-b transition-colors hover:bg-panel-subtle">
      <TableCell onClick={(e) => e.stopPropagation()}>
        <Switch
          checked={isActive}
          onCheckedChange={() => onToggleActive(automation)}
          title={isActive ? 'Disable' : 'Enable'}
          className="brand-switch"
        />
      </TableCell>
      <TableCell className="font-medium">
        <div className="flex flex-col">
          <span className="text-ink">{automation.name}</span>
          {automation.description && (
            <span className="text-subtle-copy max-w-[200px] truncate text-xs">
              {automation.description}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={getStatusColor(automation.status)}>
          {getStatusLabel(automation.status)}
        </Badge>
      </TableCell>
      <TableCell className="text-subtle-copy text-sm">
        {formatTimestamp(automation.lastRunAt)}
      </TableCell>
      <TableCell className="text-right">
        <div
          className="flex items-center justify-end gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <AutomationActionsMenu
            automation={automation}
            isRunning={isRunning}
            canRun={canRun}
            onRun={onRun}
            {...menuProps}
          />
        </div>
      </TableCell>
    </TableRow>
  )
}

/* ── Main Component ── */

/* ── Desktop table header ── */

function AutomationsTableHeader() {
  return (
    <TableHeader>
      <TableRow className="border-line-soft border-b hover:bg-transparent">
        <TableHead className="text-muted-copy w-[80px] font-medium">Active</TableHead>
        <TableHead className="text-muted-copy w-[250px] font-medium">Name</TableHead>
        <TableHead className="text-muted-copy w-[200px] font-medium">Status</TableHead>
        <TableHead className="text-muted-copy w-[150px] font-medium">Last Run</TableHead>
        <TableHead className="text-muted-copy w-[100px] text-right font-medium">Actions</TableHead>
      </TableRow>
    </TableHeader>
  )
}

export function AutomationsList({
  automations, loading, onToggleActive, onRun, onStopRun,
  onEdit, onEditFlow, onDuplicate, onExport, onDelete, onViewDetails,
}: AutomationsListProps) {
  const isMobile = useIsMobile()

  if (loading) {
    return <div className="text-subtle-copy p-8 text-center">Loading automations...</div>
  }
  if (automations.length === 0) {
    return <div className="text-subtle-copy p-8 text-center">No automations found. Create one to get started.</div>
  }

  const sharedMenuProps = { onStopRun, onViewDetails, onEditFlow, onEdit, onDuplicate, onExport, onDelete }

  if (isMobile) {
    return (
      <div className="space-y-4">
        {automations.map((automation) => (
          <AutomationMobileCard key={automation._id} automation={automation}
            onToggleActive={onToggleActive} onRun={onRun} {...sharedMenuProps} />
        ))}
      </div>
    )
  }

  return (
    <div className="bg-panel-subtle border-line-soft overflow-hidden rounded-2xl border backdrop-blur-xs">
      <Table>
        <AutomationsTableHeader />
        <TableBody>
          {automations.map((automation) => (
            <AutomationDesktopRow key={automation._id} automation={automation}
              onToggleActive={onToggleActive} onRun={onRun} {...sharedMenuProps} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
