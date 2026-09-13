import { useState } from 'react'
import {
  Briefcase,
  MoreHorizontal,
  Pencil,
  Play,
  Square,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useIsMobile } from '@/hooks/use-mobile'
import type { ScrapeJob } from '../types'
import { formatDateTime, formatNumber, getJobRowCount } from '../utils'

interface ScrapeJobsListProps {
  jobs: ScrapeJob[]
  loading: boolean
  actionPendingId: string | null
  onRun: (job: ScrapeJob) => void
  onStop: (job: ScrapeJob) => void
  onEdit: (job: ScrapeJob) => void
  onDelete: (job: ScrapeJob) => void
  emptyTitle?: string
  emptyDescription?: string
}

interface JobActionsMenuProps {
  job: ScrapeJob
  actionPending: boolean
  onRun: (job: ScrapeJob) => void
  onStop: (job: ScrapeJob) => void
  onEdit: (job: ScrapeJob) => void
  onDelete: (job: ScrapeJob) => void
}

function statusBadgeClass(status: ScrapeJob['status']) {
  switch (status) {
    case 'running':
      return 'bg-status-success-soft text-status-success border-status-success-border'
    case 'failed':
      return 'bg-status-danger-soft text-status-danger border-status-danger-border'
    case 'cancelled':
      return 'bg-status-warning-soft text-status-warning border-status-warning-border'
    default:
      return 'border-line bg-panel-muted text-copy'
  }
}

function JobActionsMenu({ job, actionPending, onRun, onStop, onEdit, onDelete }: JobActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const running = job.status === 'running'

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={actionPending}
          className="text-muted-copy hover:text-ink hover:bg-panel-muted data-[state=open]:bg-panel-muted data-[state=open]:text-ink h-8 w-8"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="panel-dropdown">
        {running ? (
          <DropdownMenuItem onClick={() => onStop(job)}>
            <Square className="mr-2 h-4 w-4" /> Stop
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => onRun(job)}>
            <Play className="mr-2 h-4 w-4" /> Run
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => onEdit(job)} disabled={running}>
          <Pencil className="mr-2 h-4 w-4" /> Edit
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onDelete(job)}
          disabled={running}
          className="text-status-danger focus:text-status-danger focus:bg-status-danger-soft cursor-pointer"
        >
          <Trash2 className="mr-2 h-4 w-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function jobSubtitle(job: ScrapeJob) {
  const skipped = Math.max(0, Math.floor(Number(job.stats?.deduped) || 0))
  return skipped > 0
    ? `${job.targets.length} post(s) · ${skipped} skipped`
    : `${job.targets.length} post(s)`
}

/* ── Mobile card ── */

function JobMobileCard(props: JobActionsMenuProps) {
  const { job } = props
  return (
    <div className="bg-panel-strong border-line hover:border-line-strong rounded-2xl border p-4 shadow-xs transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-ink truncate text-base font-semibold">{job.name || 'Untitled job'}</h3>
          <p className="text-subtle-copy mt-1 truncate text-[11px]">
            {jobSubtitle(job)}
          </p>
        </div>
        <div onClick={(event) => event.stopPropagation()}>
          <JobActionsMenu {...props} />
        </div>
      </div>
      <div className="text-muted-copy mt-4 flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline" className={statusBadgeClass(job.status)}>{job.status}</Badge>
      </div>
      <div className="border-line mt-4 flex items-center justify-between gap-3 border-t pt-3">
        <div className="min-w-0">
          <div className="text-subtle-copy text-[11px] font-semibold tracking-[0.18em] uppercase">Rows</div>
          <div className="text-copy mt-1 text-xs">{formatNumber(getJobRowCount(job))}</div>
        </div>
        <div className="min-w-0 text-right">
          <div className="text-subtle-copy text-[11px] font-semibold tracking-[0.18em] uppercase">Updated</div>
          <div className="text-copy mt-1 text-xs">{formatDateTime(job.updatedAt ?? job.createdAt ?? null)}</div>
        </div>
      </div>
      {job.error && <p className="text-status-danger mt-3 text-xs">{job.error}</p>}
    </div>
  )
}

/* ── Desktop row ── */

function JobDesktopRow(props: JobActionsMenuProps) {
  const { job } = props
  return (
    <TableRow className="group border-line-soft h-14 border-b transition-colors hover:bg-panel-subtle">
      <TableCell className="pl-4 font-medium">
        <div className="flex flex-col gap-0.5">
          <span className="text-ink truncate">{job.name || 'Untitled job'}</span>
          <span className="text-subtle-copy max-w-[250px] truncate text-[11px]">
            {jobSubtitle(job)}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={statusBadgeClass(job.status)}>{job.status}</Badge>
      </TableCell>
      <TableCell className="text-copy text-sm">{formatNumber(getJobRowCount(job))}</TableCell>
      <TableCell className="text-subtle-copy text-sm">
        {formatDateTime(job.updatedAt ?? job.createdAt ?? null)}
      </TableCell>
      <TableCell className="pr-4 text-right">
        <div
          className="flex items-center justify-end gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <JobActionsMenu {...props} />
        </div>
      </TableCell>
    </TableRow>
  )
}

/* ── Main component ── */

export function ScrapeJobsList({
  jobs,
  loading,
  actionPendingId,
  onRun,
  onStop,
  onEdit,
  onDelete,
  emptyTitle = 'No scrape jobs',
  emptyDescription = 'Create a job to start scraping followers or following lists.',
}: ScrapeJobsListProps) {
  const isMobile = useIsMobile()

  if (loading && jobs.length === 0) {
    return (
      <div className="text-muted-foreground animate-pulse p-12 text-center text-sm">
        Loading scrape jobs...
      </div>
    )
  }

  if (jobs.length === 0) {
    return (
      <div className="bg-muted/5 flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
        <Briefcase className="text-muted-foreground/50 mb-4 h-10 w-10" />
        <h3 className="text-lg font-medium">{emptyTitle}</h3>
        <p className="text-muted-foreground mt-1 text-sm">{emptyDescription}</p>
      </div>
    )
  }

  if (isMobile) {
    return (
      <div className="space-y-4">
        {jobs.map((job) => (
          <JobMobileCard
            key={String(job._id)}
            job={job}
            actionPending={actionPendingId === String(job._id)}
            onRun={onRun}
            onStop={onStop}
            onEdit={onEdit}
            onDelete={onDelete}
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
            <TableHead className="text-muted-copy h-12 w-[300px] pl-4 font-medium">Name</TableHead>
            <TableHead className="text-muted-copy h-12 w-[120px] font-medium">Status</TableHead>
            <TableHead className="text-muted-copy h-12 w-[100px] font-medium">Rows</TableHead>
            <TableHead className="text-muted-copy h-12 w-[160px] font-medium">Updated</TableHead>
            <TableHead className="text-muted-copy h-12 w-[100px] pr-4 text-right font-medium">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <JobDesktopRow
              key={String(job._id)}
              job={job}
              actionPending={actionPendingId === String(job._id)}
              onRun={onRun}
              onStop={onStop}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
