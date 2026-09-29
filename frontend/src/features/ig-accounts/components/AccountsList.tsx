import type { KeyboardEvent } from 'react'
import { RefreshCw, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export type AccountStatus = 'available' | 'assigned' | 'connected' | 'invalid'

export type Account = {
  id: string
  username: string
  status: AccountStatus
  profileId?: string
  error?: string
  browserLoggedInAt?: number
}

interface AccountsListProps {
  accounts: Account[]
  loading: boolean
  emptyTitle?: string
  emptyDescription?: string
  onSelect?: (account: Account) => void
}

export function StatusBadge({ account }: { account: Account }) {
  switch (account.status) {
    case 'available':
      return (
        <Badge
          variant="outline"
          className="border-status-success-border bg-status-success-soft text-status-success text-[10px] tracking-[0.14em] uppercase"
        >
          Available
        </Badge>
      )
    case 'assigned':
      return (
        <Badge
          variant="outline"
          className="border-status-info-border bg-status-info-soft text-status-info text-[10px] tracking-[0.14em] uppercase"
        >
          {account.browserLoggedInAt ? 'Browser logged in' : 'Assigned'}
        </Badge>
      )
    case 'connected':
      return (
        <Badge
          variant="outline"
          className="border-status-success-border bg-status-success-soft text-status-success text-[10px] tracking-[0.14em] uppercase"
        >
          Connected
        </Badge>
      )
    case 'invalid':
      return (
        <Badge
          variant="outline"
          className="border-status-danger-border bg-status-danger-soft text-status-danger text-[10px] tracking-[0.14em] uppercase"
        >
          Invalid
        </Badge>
      )
  }
}

function handleSelectKey(
  event: KeyboardEvent,
  onSelect: () => void,
) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    onSelect()
  }
}

function accountDetail(account: Account): string | undefined {
  if (account.error) return account.error
  if (account.status === 'assigned' && account.browserLoggedInAt)
    return 'Feed warmup starts the next day. Mobile login and name change run on day 3 through the Work proxy'
  return undefined
}

/* ── Mobile card ── */

function AccountMobileCard({
  account,
  onSelect,
}: {
  account: Account
  onSelect?: (account: Account) => void
}) {
  const detail = accountDetail(account)

  return (
    <div
      onClick={onSelect ? () => onSelect(account) : undefined}
      onKeyDown={
        onSelect ? (event) => handleSelectKey(event, () => onSelect(account)) : undefined
      }
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      className={`bg-panel-strong border-line hover:border-line-strong rounded-2xl border p-4 shadow-xs transition-colors${onSelect ? ' cursor-pointer' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-ink truncate text-base font-semibold">
            {account.username ? `@${account.username}` : 'Unreadable credential'}
          </h3>
        </div>
        <StatusBadge account={account} />
      </div>
      {detail && (
        <div className="border-line mt-4 border-t pt-3">
          <div className="text-subtle-copy text-[11px] font-semibold tracking-[0.18em] uppercase">
            Detail
          </div>
          <p
            className={`${account.error ? 'text-status-danger' : 'text-subtle-copy'} mt-1 line-clamp-2 text-xs`}
          >
            {detail}
          </p>
        </div>
      )}
    </div>
  )
}

/* ── Desktop row ── */

function AccountDesktopRow({
  account,
  index,
  onSelect,
}: {
  account: Account
  index: number
  onSelect?: (account: Account) => void
}) {
  const detail = accountDetail(account)

  return (
    <TableRow
      onClick={onSelect ? () => onSelect(account) : undefined}
      onKeyDown={
        onSelect ? (event) => handleSelectKey(event, () => onSelect(account)) : undefined
      }
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      className={`group border-line-soft h-14 border-b transition-colors hover:bg-panel-subtle${onSelect ? ' cursor-pointer' : ''}`}>
      <TableCell className="w-[80px] pl-4">
        <span className="text-subtle-copy font-mono text-sm">{index + 1}</span>
      </TableCell>
      <TableCell className="font-medium">
        <span className="text-ink truncate">
          {account.username ? `@${account.username}` : 'Unreadable credential'}
        </span>
      </TableCell>
      <TableCell>
        <StatusBadge account={account} />
      </TableCell>
      <TableCell className="pr-4">
        {detail ? (
          <span
            className={`${account.error ? 'text-status-danger' : 'text-subtle-copy'} block max-w-[280px] truncate text-xs`}
            title={detail}
          >
            {detail}
          </span>
        ) : (
          <span className="text-subtle-copy/50 text-xs">-</span>
        )}
      </TableCell>
    </TableRow>
  )
}

/* ── Main component ── */

export function AccountsList({
  accounts,
  loading,
  emptyTitle = 'No accounts',
  emptyDescription = 'Import credentials to get started.',
  onSelect,
}: AccountsListProps) {
  const isMobile = useIsMobile()

  if (loading && accounts.length === 0) {
    return (
      <div className="text-muted-foreground flex animate-pulse items-center justify-center gap-2 p-12 text-center text-sm">
        <RefreshCw className="h-4 w-4 shrink-0 animate-spin" /> Loading
        accounts...
      </div>
    )
  }

  if (accounts.length === 0) {
    return (
      <div className="border-line-soft bg-panel-subtle flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 text-center">
        <Users className="text-subtle-copy mb-4 h-10 w-10" />
        <h3 className="text-ink text-lg font-medium">{emptyTitle}</h3>
        <p className="text-subtle-copy mt-1 text-sm">{emptyDescription}</p>
      </div>
    )
  }

  if (isMobile) {
    return (
      <div className="space-y-4">
        {accounts.map((account) => (
          <AccountMobileCard key={account.id} account={account} onSelect={onSelect} />
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
              No.
            </TableHead>
            <TableHead className="text-muted-copy h-12 w-[250px] font-medium">
              Account
            </TableHead>
            <TableHead className="text-muted-copy h-12 w-[200px] font-medium">
              Status
            </TableHead>
            <TableHead className="text-muted-copy h-12 pr-4 font-medium">
              Detail
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((account, index) => (
            <AccountDesktopRow
              key={account.id}
              account={account}
              index={index}
              onSelect={onSelect}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
