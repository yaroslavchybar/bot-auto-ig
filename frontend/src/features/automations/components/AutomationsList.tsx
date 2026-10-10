import { useState } from 'react'
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
import { MoreHorizontal, Pencil, Trash2, Copy, Bot, RefreshCw } from 'lucide-react'
import type { Automation } from '../types'
import {
  formatTimestamp,
  getAutomationDisplayStatus,
  getStatusColor,
  getStatusLabel,
} from '../types'
import { cn } from '@/lib/utils'

interface AutomationsListProps {
  automations: Automation[]
  loading: boolean
  onToggleActive: (automation: Automation) => void
  onManage: (automation: Automation) => void
  onDuplicate: (automation: Automation) => void
  onDelete: (automation: Automation) => void
}

interface AutomationActionsMenuProps {
  automation: Automation
  onManage: (automation: Automation) => void
  onDuplicate: (automation: Automation) => void
  onDelete: (automation: Automation) => void
}

/* ── Actions menu ── */

function AutomationActionsMenu({
  automation,
  onManage,
  onDuplicate,
  onDelete,
}: AutomationActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const busy =
    automation.isActive === true ||
    automation.status === 'running' ||
    automation.status === 'pending'

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Actions for ${automation.name}`}
          className="h-8 w-8 text-muted-copy hover:bg-panel-muted hover:text-ink data-[state=open]:bg-panel-muted data-[state=open]:text-ink"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-48 panel-dropdown"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuItem
          onClick={() => {
            setOpen(false)
            window.requestAnimationFrame(() => onManage(automation))
          }}
          className="cursor-pointer hover:bg-panel-hover focus:bg-panel-hover"
        >
          <Pencil className="mr-2 h-4 w-4" /> Manage
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onDuplicate(automation)}
          className="cursor-pointer hover:bg-panel-hover focus:bg-panel-hover"
        >
          <Copy className="mr-2 h-4 w-4" /> Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-panel-muted" />
        <DropdownMenuItem
          onClick={() => onDelete(automation)}
          disabled={busy}
          className="cursor-pointer text-status-danger hover:bg-status-danger-soft focus:bg-status-danger-soft focus:text-status-danger"
        >
          <Trash2 className="mr-2 h-4 w-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* ── Mobile card ── */

function AutomationMobileCard({
  automation,
  onToggleActive,
  onManage,
  onDuplicate,
  onDelete,
}: {
  automation: Automation
} & Omit<AutomationsListProps, 'automations' | 'loading'>) {
  const isActive = automation.isActive ?? false
  const displayStatus = getAutomationDisplayStatus(automation)
  const isRunning = displayStatus === 'running'

  return (
    <div
      className={cn(
        'bg-panel-strong border-line hover:border-line-strong rounded-2xl border p-4 shadow-xs',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold text-ink">{automation.name}</h3>
            <Badge
              role="status"
              variant="outline"
              className={cn(
                'shrink-0 border text-[10px] tracking-[0.18em] uppercase',
                isRunning
                  ? 'border-status-success-border bg-status-success-soft text-status-success'
                  : displayStatus === 'failed'
                    ? 'border-status-danger-border bg-status-danger-soft text-status-danger'
                    : 'border-line bg-panel-muted text-copy',
              )}
            >
              {getStatusLabel(displayStatus)}
            </Badge>
          </div>
          <p className="mt-2 text-xs text-subtle-copy">
            {automation.listIds?.length
              ? `${automation.listIds.length} model${automation.listIds.length === 1 ? '' : 's'}`
              : 'No model selected'}
          </p>
          {automation.error && (
            <p className="mt-1 line-clamp-2 text-xs text-status-danger">{automation.error}</p>
          )}
        </div>
        <div onClick={(event) => event.stopPropagation()}>
          <AutomationActionsMenu
            automation={automation}
            onManage={onManage}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
          />
        </div>
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold tracking-[0.18em] text-subtle-copy uppercase">
              Last Run
            </div>
            <div className="mt-1 text-xs text-copy">{formatTimestamp(automation.lastRunAt)}</div>
          </div>
          <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
            <span className="text-[10px] font-bold tracking-[0.18em] text-subtle-copy uppercase">
              {isActive ? 'Enabled' : 'Disabled'}
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
    </div>
  )
}

/* ── Desktop row ── */

function AutomationDesktopRow({
  automation,
  onToggleActive,
  onManage,
  onDuplicate,
  onDelete,
}: {
  automation: Automation
} & Omit<AutomationsListProps, 'automations' | 'loading'>) {
  const isActive = automation.isActive ?? false
  const displayStatus = getAutomationDisplayStatus(automation)

  return (
    <TableRow
      className="group h-14 border-b border-line-soft hover:bg-panel-subtle"
      onClick={() => onManage(automation)}
    >
      <TableCell className="w-[80px] pl-4" onClick={(e) => e.stopPropagation()}>
        <Switch
          checked={isActive}
          onCheckedChange={() => onToggleActive(automation)}
          title={isActive ? 'Disable' : 'Enable'}
          className="brand-switch"
        />
      </TableCell>
      <TableCell className="font-medium">
        <div className="flex flex-col gap-0.5">
          <span className="truncate text-ink">{automation.name}</span>
          <span className="text-xs text-subtle-copy">
            {automation.listIds?.length
              ? `${automation.listIds.length} model${automation.listIds.length === 1 ? '' : 's'}`
              : 'No model selected'}
          </span>
          {automation.error && (
            <span className="max-w-[280px] truncate text-xs text-status-danger">
              {automation.error}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <Badge role="status" variant={getStatusColor(displayStatus)}>
          {getStatusLabel(displayStatus)}
        </Badge>
      </TableCell>
      <TableCell className="text-sm whitespace-nowrap text-subtle-copy">
        {formatTimestamp(automation.lastRunAt)}
      </TableCell>
      <TableCell className="pr-4 text-right">
        <div
          className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <AutomationActionsMenu
            automation={automation}
            onManage={onManage}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
          />
        </div>
      </TableCell>
    </TableRow>
  )
}

/* ── Main component ── */

export function AutomationsList({
  automations,
  loading,
  onToggleActive,
  onManage,
  onDuplicate,
  onDelete,
}: AutomationsListProps) {
  const isMobile = useIsMobile()

  if (loading && automations.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 p-12 text-center text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4 shrink-0" /> Loading automations...
      </div>
    )
  }

  if (automations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line-soft bg-panel-subtle p-12 text-center">
        <Bot className="mb-4 h-10 w-10 text-subtle-copy" />
        <h3 className="text-lg font-medium text-ink">No automations</h3>
        <p className="mt-1 max-w-sm text-sm text-subtle-copy">
          Create one automation for each model you want to manage.
        </p>
      </div>
    )
  }

  const rowProps = { onToggleActive, onManage, onDuplicate, onDelete }

  if (isMobile) {
    return (
      <div className="space-y-4">
        {automations.map((automation) => (
          <AutomationMobileCard key={automation._id} automation={automation} {...rowProps} />
        ))}
      </div>
    )
  }

  return (
    <div className="-mx-4 overflow-hidden border border-line-soft bg-panel-subtle shadow-xs md:-mx-6">
      <Table>
        <TableHeader>
          <TableRow className="border-b border-line-soft bg-transparent hover:bg-transparent">
            <TableHead className="h-12 w-[80px] pl-4 font-medium text-muted-copy">Active</TableHead>
            <TableHead className="h-12 w-[250px] font-medium text-muted-copy">Name</TableHead>
            <TableHead className="h-12 w-[200px] font-medium text-muted-copy">Status</TableHead>
            <TableHead className="h-12 w-[150px] font-medium text-muted-copy">Last Run</TableHead>
            <TableHead className="h-12 w-[100px] pr-4 text-right font-medium text-muted-copy">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {automations.map((automation) => (
            <AutomationDesktopRow key={automation._id} automation={automation} {...rowProps} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
