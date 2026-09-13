import { ContactRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useIsMobile } from '@/hooks/use-mobile'
import type { ScrapedAccount } from '../types'
import { formatDateTime } from '../utils'

interface ScrapedAccountsListProps {
  accounts: ScrapedAccount[]
  jobNames: Record<string, string>
  loading: boolean
  emptyTitle?: string
  emptyDescription?: string
}

function flagBadge(value: boolean | null | undefined) {
  if (value === true) return <Badge variant="outline" className="bg-status-success-soft text-status-success border-status-success-border">Yes</Badge>
  if (value === false) return <span className="text-subtle-copy text-xs">No</span>
  return <span className="text-subtle-copy text-xs">-</span>
}

/* ── Mobile card ── */

function AccountMobileCard({ account, jobName }: { account: ScrapedAccount; jobName: string }) {
  return (
    <div className="bg-panel-strong border-line hover:border-line-strong rounded-2xl border p-4 shadow-xs transition-colors">
      <div className="min-w-0 flex-1">
        <h3 className="text-ink truncate text-base font-semibold">@{account.userName}</h3>
        <p className="text-subtle-copy mt-1 truncate text-[11px]">
          {[account.fullName, jobName].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="text-muted-copy mt-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-copy">Verified:</span> {flagBadge(account.isVerified)}
        <span className="text-copy ml-2">Private:</span> {flagBadge(account.isPrivate)}
      </div>
      <div className="border-line mt-4 flex items-center justify-between gap-3 border-t pt-3">
        <div className="min-w-0">
          <div className="text-subtle-copy text-[11px] font-semibold tracking-[0.18em] uppercase">Status</div>
          <div className="text-copy mt-1 text-xs">{account.status || '-'}</div>
        </div>
        <div className="min-w-0 text-right">
          <div className="text-subtle-copy text-[11px] font-semibold tracking-[0.18em] uppercase">Scraped</div>
          <div className="text-copy mt-1 text-xs">{formatDateTime(account.createdAt ?? null)}</div>
        </div>
      </div>
    </div>
  )
}

/* ── Desktop row ── */

function AccountDesktopRow({ account, jobName }: { account: ScrapedAccount; jobName: string }) {
  return (
    <TableRow className="border-line-soft h-14 border-b transition-colors hover:bg-panel-subtle">
      <TableCell className="pl-4 font-medium">
        <div className="flex flex-col gap-0.5">
          <span className="text-ink truncate">@{account.userName}</span>
          <span className="text-subtle-copy max-w-[250px] truncate text-[11px]">{jobName}</span>
        </div>
      </TableCell>
      <TableCell className="text-copy max-w-[200px] truncate text-sm">{account.fullName || '-'}</TableCell>
      <TableCell>{flagBadge(account.isVerified)}</TableCell>
      <TableCell>{flagBadge(account.isPrivate)}</TableCell>
      <TableCell className="text-copy text-sm">{account.status || '-'}</TableCell>
      <TableCell className="text-subtle-copy pr-4 text-sm">{formatDateTime(account.createdAt ?? null)}</TableCell>
    </TableRow>
  )
}

/* ── Main component ── */

export function ScrapedAccountsList({
  accounts,
  jobNames,
  loading,
  emptyTitle = 'No scraped accounts',
  emptyDescription = 'Completed job runs will add accounts here.',
}: ScrapedAccountsListProps) {
  const isMobile = useIsMobile()

  if (loading && accounts.length === 0) {
    return (
      <div className="text-muted-foreground animate-pulse p-12 text-center text-sm">
        Loading scraped accounts...
      </div>
    )
  }

  if (accounts.length === 0) {
    return (
      <div className="bg-muted/5 flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
        <ContactRound className="text-muted-foreground/50 mb-4 h-10 w-10" />
        <h3 className="text-lg font-medium">{emptyTitle}</h3>
        <p className="text-muted-foreground mt-1 text-sm">{emptyDescription}</p>
      </div>
    )
  }

  if (isMobile) {
    return (
      <div className="space-y-4">
        {accounts.map((account) => (
          <AccountMobileCard
            key={String(account._id)}
            account={account}
            jobName={jobNames[String(account.sourceJobId)] ?? ''}
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
            <TableHead className="text-muted-copy h-12 w-[280px] pl-4 font-medium">Username</TableHead>
            <TableHead className="text-muted-copy h-12 w-[200px] font-medium">Full Name</TableHead>
            <TableHead className="text-muted-copy h-12 w-[100px] font-medium">Verified</TableHead>
            <TableHead className="text-muted-copy h-12 w-[100px] font-medium">Private</TableHead>
            <TableHead className="text-muted-copy h-12 w-[120px] font-medium">Status</TableHead>
            <TableHead className="text-muted-copy h-12 w-[160px] pr-4 font-medium">Scraped</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((account) => (
            <AccountDesktopRow
              key={String(account._id)}
              account={account}
              jobName={jobNames[String(account.sourceJobId)] ?? ''}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
