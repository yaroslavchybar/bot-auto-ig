import { AtSign, ExternalLink, RefreshCw, Users } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import type { Id } from '../../../../../convex/_generated/dataModel'

export type Lead = {
  _id: Id<'leads'>
  username: string
  status: string
  dmSent: boolean
  followed: boolean
  followDate?: number
  followPending?: boolean
  senderName?: string
  source: string
  createdAt: number
}

export const LEAD_STATUS_META: Record<string, { label: string; className: string }> = {
  new: {
    label: 'New',
    className: 'bg-panel-muted text-copy border-line',
  },
  ready: {
    label: 'Ready',
    className:
      'bg-status-warning-soft text-status-warning border-status-warning-border',
  },
  reserved: {
    label: 'Reserved',
    className: 'bg-status-info-soft text-status-info border-status-info-border',
  },
  contacted: {
    label: 'Contacted',
    className: 'bg-status-info-soft text-status-info border-status-info-border',
  },
  replied: {
    label: 'Replied',
    className:
      'bg-status-success-soft text-status-success border-status-success-border',
  },
  uncertain: {
    label: 'Uncertain',
    className:
      'bg-status-warning-soft text-status-warning border-status-warning-border',
  },
  do_not_contact: {
    label: 'Do not contact',
    className:
      'bg-status-danger-soft text-status-danger border-status-danger-border',
  },
}

export function LeadStatusBadge({ status }: { status: string }) {
  const meta = LEAD_STATUS_META[status] ?? {
    label: status.replaceAll('_', ' '),
    className: 'bg-panel-muted text-copy border-line',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        meta.className,
      )}
    >
      {meta.label}
    </span>
  )
}

interface LeadsListProps {
  leads: Lead[]
  loading: boolean
  selected: Id<'leads'>[]
  onToggleSelect: (id: Id<'leads'>) => void
  onToggleSelectAll: () => void
  hasActiveFilter: boolean
}

function LeadInstagramLink({ username }: { username: string }) {
  return (
    <a
      href={`https://www.instagram.com/${username}/`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="brand-link group/link inline-flex items-center gap-1.5 font-medium"
    >
      <AtSign className="text-subtle-copy h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{username}</span>
      <ExternalLink className="text-subtle-copy h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/link:opacity-100" />
    </a>
  )
}

/* ── Mobile Card ── */

function LeadMobileCard({
  lead,
  checked,
  onToggleSelect,
}: {
  lead: Lead
  checked: boolean
  onToggleSelect: (id: Id<'leads'>) => void
}) {
  return (
    <div
      className={cn(
        'bg-panel-strong rounded-2xl border p-4 shadow-xs transition-colors',
        checked ? 'border-line-strong' : 'border-line hover:border-line-strong',
      )}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          aria-label={`Select ${lead.username}`}
          checked={checked}
          onCheckedChange={() => onToggleSelect(lead._id)}
          className="brand-checkbox mt-1"
        />
        <div className="min-w-0 flex-1">
          <LeadInstagramLink username={lead.username} />
          <div className="mt-2">
            <LeadStatusBadge status={lead.status} />
          </div>
        </div>
      </div>
      <div className="text-muted-copy mt-4 space-y-1.5 border-t border-line pt-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-subtle-copy">DM sent</span>
          <span>{lead.dmSent ? 'Yes' : lead.status === 'uncertain' ? 'Needs review' : 'No'}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-subtle-copy">Followed</span>
          <span>{lead.followPending ? 'Needs review' : lead.followed ? 'Yes' : 'No'}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-subtle-copy">Follow date</span>
          <span>{lead.followDate ? new Date(lead.followDate).toLocaleDateString() : '—'}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-subtle-copy">Sender</span>
          <span className="text-copy truncate">{lead.senderName ?? '—'}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-subtle-copy">Source</span>
          <span className="text-copy max-w-[60%] truncate text-right">
            {lead.source || '—'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-subtle-copy">Imported</span>
          <span className="text-copy">
            {new Date(lead.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>
    </div>
  )
}

/* ── Desktop Row ── */

function LeadDesktopRow({
  lead,
  checked,
  onToggleSelect,
}: {
  lead: Lead
  checked: boolean
  onToggleSelect: (id: Id<'leads'>) => void
}) {
  return (
    <TableRow
      className={cn(
        'group border-line-soft h-14 border-b transition-colors hover:bg-panel-subtle',
        checked && 'bg-panel-subtle',
      )}
    >
      <TableCell className="w-[44px] pl-4">
        <Checkbox
          aria-label={`Select ${lead.username}`}
          checked={checked}
          onCheckedChange={() => onToggleSelect(lead._id)}
          className="brand-checkbox"
        />
      </TableCell>
      <TableCell className="max-w-[220px] font-medium">
        <LeadInstagramLink username={lead.username} />
      </TableCell>
      <TableCell>
        <LeadStatusBadge status={lead.status} />
      </TableCell>
      <TableCell className="max-w-[160px]">
        <span className="text-copy text-xs">{lead.dmSent ? 'Yes' : lead.status === 'uncertain' ? 'Needs review' : 'No'}</span>
      </TableCell>
      <TableCell className="text-copy text-xs">
        {lead.followPending ? 'Needs review' : lead.followed ? 'Yes' : 'No'}
      </TableCell>
      <TableCell className="text-muted-copy text-xs whitespace-nowrap">
        {lead.followDate ? new Date(lead.followDate).toLocaleDateString() : '—'}
      </TableCell>
      <TableCell className="max-w-[160px]">
        <span className="text-copy block truncate text-xs">
          {lead.senderName ?? '—'}
        </span>
      </TableCell>
      <TableCell className="max-w-[200px]">
        <span className="text-muted-copy block truncate text-xs">
          {lead.source || '—'}
        </span>
      </TableCell>
      <TableCell className="pr-4">
        <span className="text-muted-copy text-xs whitespace-nowrap">
          {new Date(lead.createdAt).toLocaleDateString()}
        </span>
      </TableCell>
    </TableRow>
  )
}

/* ── Main component ── */

export function LeadsList({
  leads,
  loading,
  selected,
  onToggleSelect,
  onToggleSelectAll,
  hasActiveFilter,
}: LeadsListProps) {
  const isMobile = useIsMobile()
  const selectedSet = new Set(selected)
  const allChecked = leads.length > 0 && leads.every((l) => selectedSet.has(l._id))

  if (loading && leads.length === 0) {
    return (
      <div className="text-muted-foreground flex animate-pulse items-center justify-center gap-2 p-12 text-center text-sm">
        <RefreshCw className="h-4 w-4 shrink-0 animate-spin" /> Loading leads...
      </div>
    )
  }

  if (leads.length === 0) {
    return (
      <div className="border-line-soft bg-panel-subtle flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 text-center">
        <Users className="text-subtle-copy mb-4 h-10 w-10" />
        <h3 className="text-ink text-lg font-medium">
          {hasActiveFilter ? 'No matching leads' : 'No leads yet'}
        </h3>
        <p className="text-subtle-copy mt-1 max-w-sm text-sm">
          {hasActiveFilter
            ? 'Try a different search term or clear the filters.'
            : 'Import recipients to review eligibility, then mark them Ready for outreach.'}
        </p>
      </div>
    )
  }

  if (isMobile) {
    return (
      <div className="space-y-3">
        {leads.map((lead) => (
          <LeadMobileCard
            key={lead._id}
            lead={lead}
            checked={selectedSet.has(lead._id)}
            onToggleSelect={onToggleSelect}
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
            <TableHead className="w-[44px] pl-4">
              <Checkbox
                aria-label="Select all leads"
                checked={allChecked}
                onCheckedChange={onToggleSelectAll}
                className="brand-checkbox"
              />
            </TableHead>
            <TableHead className="text-muted-copy h-12 font-medium">Username</TableHead>
            <TableHead className="text-muted-copy h-12 w-[150px] font-medium">Status</TableHead>
            <TableHead className="text-muted-copy h-12 font-medium">DM sent</TableHead>
            <TableHead className="text-muted-copy h-12 font-medium">Followed</TableHead>
            <TableHead className="text-muted-copy h-12 font-medium">Follow date</TableHead>
            <TableHead className="text-muted-copy h-12 w-[160px] font-medium">Sender</TableHead>
            <TableHead className="text-muted-copy h-12 font-medium">Source</TableHead>
            <TableHead className="text-muted-copy h-12 w-[120px] pr-4 font-medium">Imported</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map((lead) => (
            <LeadDesktopRow
              key={lead._id}
              lead={lead}
              checked={selectedSet.has(lead._id)}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
