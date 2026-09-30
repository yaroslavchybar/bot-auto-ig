import type { KeyboardEvent } from 'react'
import { RefreshCw, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  reconnectRequired?: boolean
}

interface AccountsListProps {
  accounts: Account[]
  loading: boolean
  emptyTitle?: string
  emptyDescription?: string
  onSelect?: (account: Account) => void
  onReconnect?: (account: Account) => void
  reconnectingId?: string | null
}

export function StatusBadge({ account }: { account: Account }) {
  if (account.reconnectRequired)
    return (
      <Badge
        variant="outline"
        className="border-status-warning-border bg-status-warning-soft text-[10px] tracking-[0.14em] text-status-warning uppercase"
      >
        Reconnect needed
      </Badge>
    )
  switch (account.status) {
    case 'available':
      return (
        <Badge
          variant="outline"
          className="border-status-success-border bg-status-success-soft text-[10px] tracking-[0.14em] text-status-success uppercase"
        >
          Available
        </Badge>
      )
    case 'assigned':
      return (
        <Badge
          variant="outline"
          className="border-status-info-border bg-status-info-soft text-[10px] tracking-[0.14em] text-status-info uppercase"
        >
          {account.browserLoggedInAt ? 'Browser logged in' : 'Assigned'}
        </Badge>
      )
    case 'connected':
      return (
        <Badge
          variant="outline"
          className="border-status-success-border bg-status-success-soft text-[10px] tracking-[0.14em] text-status-success uppercase"
        >
          Connected
        </Badge>
      )
    case 'invalid':
      return (
        <Badge
          variant="outline"
          className="border-status-danger-border bg-status-danger-soft text-[10px] tracking-[0.14em] text-status-danger uppercase"
        >
          Invalid
        </Badge>
      )
  }
}

function handleSelectKey(event: KeyboardEvent, onSelect: () => void) {
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

function ReconnectButton({
  account,
  onReconnect,
  reconnectingId,
}: Pick<AccountsListProps, 'onReconnect' | 'reconnectingId'> & { account: Account }) {
  if (!account.reconnectRequired || !onReconnect) return null
  const busy = reconnectingId === account.id
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={Boolean(reconnectingId)}
      aria-busy={busy}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onReconnect(account)
      }}
    >
      <RefreshCw className={busy ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
      {busy ? 'Reconnecting...' : 'Reconnect'}
    </Button>
  )
}

/* ── Mobile card ── */

function AccountMobileCard({
  account,
  onSelect,
  onReconnect,
  reconnectingId,
}: {
  account: Account
  onSelect?: (account: Account) => void
  onReconnect?: (account: Account) => void
  reconnectingId?: string | null
}) {
  const detail = accountDetail(account)

  return (
    <div
      onClick={onSelect ? () => onSelect(account) : undefined}
      onKeyDown={onSelect ? (event) => handleSelectKey(event, () => onSelect(account)) : undefined}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      className={`rounded-2xl border border-line bg-panel-strong p-4 hover:border-line-strong shadow-xs${onSelect ? ' cursor-pointer' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-ink">
            {account.username ? `@${account.username}` : 'Unreadable credential'}
          </h3>
        </div>
        <StatusBadge account={account} />
      </div>
      {account.reconnectRequired && (
        <div className="mt-3">
          <ReconnectButton
            account={account}
            onReconnect={onReconnect}
            reconnectingId={reconnectingId}
          />
        </div>
      )}
      {detail && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="text-[11px] font-semibold tracking-[0.18em] text-subtle-copy uppercase">
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
  onReconnect,
  reconnectingId,
}: {
  account: Account
  index: number
  onSelect?: (account: Account) => void
  onReconnect?: (account: Account) => void
  reconnectingId?: string | null
}) {
  const detail = accountDetail(account)

  return (
    <TableRow
      onClick={onSelect ? () => onSelect(account) : undefined}
      onKeyDown={onSelect ? (event) => handleSelectKey(event, () => onSelect(account)) : undefined}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      className={`group h-14 border-b border-line-soft hover:bg-panel-subtle${onSelect ? ' cursor-pointer' : ''}`}
    >
      <TableCell className="w-[80px] pl-4">
        <span className="font-mono text-sm text-subtle-copy">{index + 1}</span>
      </TableCell>
      <TableCell className="font-medium">
        <span className="truncate text-ink">
          {account.username ? `@${account.username}` : 'Unreadable credential'}
        </span>
      </TableCell>
      <TableCell>
        <StatusBadge account={account} />
      </TableCell>
      <TableCell className="pr-4">
        <div className="flex items-center justify-between gap-3">
          {detail ? (
            <span
              className={`${account.error ? 'text-status-danger' : 'text-subtle-copy'} block max-w-[280px] truncate text-xs`}
              title={detail}
            >
              {detail}
            </span>
          ) : (
            <span className="text-xs text-subtle-copy/50">-</span>
          )}
          <ReconnectButton
            account={account}
            onReconnect={onReconnect}
            reconnectingId={reconnectingId}
          />
        </div>
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
  onReconnect,
  reconnectingId,
}: AccountsListProps) {
  const isMobile = useIsMobile()

  if (loading && accounts.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 p-12 text-center text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4 shrink-0" /> Loading accounts...
      </div>
    )
  }

  if (accounts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line-soft bg-panel-subtle p-12 text-center">
        <Users className="mb-4 h-10 w-10 text-subtle-copy" />
        <h3 className="text-lg font-medium text-ink">{emptyTitle}</h3>
        <p className="mt-1 text-sm text-subtle-copy">{emptyDescription}</p>
      </div>
    )
  }

  if (isMobile) {
    return (
      <div className="space-y-4">
        {accounts.map((account) => (
          <AccountMobileCard
            key={account.id}
            account={account}
            onSelect={onSelect}
            onReconnect={onReconnect}
            reconnectingId={reconnectingId}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line-soft bg-panel-subtle shadow-xs">
      <Table>
        <TableHeader>
          <TableRow className="border-b border-line-soft bg-transparent hover:bg-transparent">
            <TableHead className="h-12 w-[80px] pl-4 font-medium text-muted-copy">No.</TableHead>
            <TableHead className="h-12 w-[250px] font-medium text-muted-copy">Account</TableHead>
            <TableHead className="h-12 w-[200px] font-medium text-muted-copy">Status</TableHead>
            <TableHead className="h-12 pr-4 font-medium text-muted-copy">Detail</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((account, index) => (
            <AccountDesktopRow
              key={account.id}
              account={account}
              index={index}
              onSelect={onSelect}
              onReconnect={onReconnect}
              reconnectingId={reconnectingId}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
