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
import {
  MoreHorizontal,
  Pencil,
  Trash2,
  Copy,
  Bot,
  RefreshCw,
} from 'lucide-react'
import type { Automation } from '../types'
import { formatTimestamp, getStatusColor, getStatusLabel } from '../types'
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
          className="text-muted-copy hover:text-ink hover:bg-panel-muted data-[state=open]:bg-panel-muted data-[state=open]:text-ink h-8 w-8"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="panel-dropdown w-48"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuItem
          onClick={() => {
            setOpen(false)
            window.requestAnimationFrame(() => onManage(automation))
          }}
          className="hover:bg-panel-hover focus:bg-panel-hover cursor-pointer"
        >
          <Pencil className="mr-2 h-4 w-4" /> Manage
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onDuplicate(automation)}
          className="hover:bg-panel-hover focus:bg-panel-hover cursor-pointer"
        >
          <Copy className="mr-2 h-4 w-4" /> Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-panel-muted" />
        <DropdownMenuItem
          onClick={() => onDelete(automation)}
          disabled={busy}
          className="text-status-danger focus:text-status-danger focus:bg-status-danger-soft hover:bg-status-danger-soft cursor-pointer"
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
  const isRunning = automation.status === 'running'

  return (
    <div
      className={cn(
        'bg-panel-strong border-line hover:border-line-strong rounded-2xl border p-4 shadow-xs transition-colors',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-ink truncate text-base font-semibold">
              {automation.name}
            </h3>
            <Badge
              variant="outline"
              className={cn(
                'shrink-0 border text-[10px] tracking-[0.18em] uppercase',
                isRunning
                  ? 'border-status-success-border bg-status-success-soft text-status-success'
                  : automation.status === 'failed'
                    ? 'border-status-danger-border bg-status-danger-soft text-status-danger'
                    : 'border-line bg-panel-muted text-copy',
              )}
            >
              {getStatusLabel(automation.status)}
            </Badge>
          </div>
          <p className="text-subtle-copy mt-2 text-xs">
            {automation.listIds?.length ?? 0} profile lists
          </p>
          {automation.error && (
            <p className="text-status-danger mt-1 line-clamp-2 text-xs">
              {automation.error}
            </p>
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

  return (
    <TableRow
      className="group border-line-soft h-14 border-b transition-colors hover:bg-panel-subtle"
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
          <span className="text-ink truncate">{automation.name}</span>
          <span className="text-subtle-copy text-xs">
            {automation.listIds?.length ?? 0} profile lists
          </span>
          {automation.error && (
            <span className="text-status-danger max-w-[280px] truncate text-xs">
              {automation.error}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={getStatusColor(automation.status)}>
          {getStatusLabel(automation.status)}
        </Badge>
      </TableCell>
      <TableCell className="text-subtle-copy text-sm whitespace-nowrap">
        {formatTimestamp(automation.lastRunAt)}
      </TableCell>
      <TableCell className="pr-4 text-right">
        <div
          className="flex items-center justify-end gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
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
      <div className="text-muted-foreground flex animate-pulse items-center justify-center gap-2 p-12 text-center text-sm">
        <RefreshCw className="h-4 w-4 shrink-0 animate-spin" /> Loading automations...
      </div>
    )
  }

  if (automations.length === 0) {
    return (
      <div className="border-line-soft bg-panel-subtle flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 text-center">
        <Bot className="text-subtle-copy mb-4 h-10 w-10" />
        <h3 className="text-ink text-lg font-medium">No automations</h3>
        <p className="text-subtle-copy mt-1 max-w-sm text-sm">
          Create an automation and select the profile lists it should manage.
        </p>
      </div>
    )
  }

  const rowProps = { onToggleActive, onManage, onDuplicate, onDelete }

  if (isMobile) {
    return (
      <div className="space-y-4">
        {automations.map((automation) => (
          <AutomationMobileCard
            key={automation._id}
            automation={automation}
            {...rowProps}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="bg-panel-subtle border-line-soft overflow-hidden rounded-2xl border shadow-xs backdrop-blur-xs">
      <Table>
        <TableHeader>
          <TableRow className="border-line-soft border-b bg-transparent hover:bg-transparent">
            <TableHead className="text-muted-copy h-12 w-[80px] pl-4 font-medium">
              Active
            </TableHead>
            <TableHead className="text-muted-copy h-12 w-[250px] font-medium">
              Name
            </TableHead>
            <TableHead className="text-muted-copy h-12 w-[200px] font-medium">
              Status
            </TableHead>
            <TableHead className="text-muted-copy h-12 w-[150px] font-medium">
              Last Run
            </TableHead>
            <TableHead className="text-muted-copy h-12 w-[100px] pr-4 text-right font-medium">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {automations.map((automation) => (
            <AutomationDesktopRow
              key={automation._id}
              automation={automation}
              {...rowProps}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
