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
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-mobile'
import { useNow } from '@/hooks/use-now'
import { Globe, MoreHorizontal, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import type { ProxyItem } from '../types'
import type { ProxyUsage } from '../utils/proxyUsage'
import { maskProxyForDisplay } from '../utils/maskProxy'
import { cn } from '@/lib/utils'

interface ProxiesListProps {
  proxies: ProxyItem[]
  usage: Record<string, ProxyUsage>
  loading: boolean
  onEdit: (proxy: ProxyItem) => void
  onDelete: (proxy: ProxyItem) => void
}

function ProxyActionsMenu({
  proxy,
  onEdit,
  onDelete,
}: {
  proxy: ProxyItem
  onEdit: (proxy: ProxyItem) => void
  onDelete: (proxy: ProxyItem) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-8 w-8 p-0 text-muted-copy hover:bg-panel-muted hover:text-ink"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-48 panel-dropdown"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuLabel className="text-muted-copy">Actions</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => onEdit(proxy)}
          className="cursor-pointer hover:bg-panel-hover focus:bg-panel-hover"
        >
          <Pencil className="mr-2 h-4 w-4" /> Edit Proxy
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onDelete(proxy)}
          className="cursor-pointer text-status-danger hover:bg-status-danger-soft focus:bg-status-danger-soft focus:text-status-danger"
        >
          <Trash2 className="mr-2 h-4 w-4" /> Delete Proxy
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ProxyTypeBadge({ proxyType }: { proxyType: string }) {
  return (
    <Badge variant="secondary" className="font-mono text-[11px] uppercase">
      {proxyType}
    </Badge>
  )
}

function ProxyPurposeBadge({ purpose }: { purpose: ProxyItem['purpose'] }) {
  return (
    <Badge variant="outline" className="text-[11px] capitalize">
      {purpose}
    </Badge>
  )
}

function ProxyUsageCell({
  proxy,
  usage,
  now,
}: {
  proxy: ProxyItem
  usage: ProxyUsage
  now: number
}) {
  if (proxy.purpose === 'login')
    return (
      <span className="text-xs text-subtle-copy">
        {proxy.loginCooldownUntil && proxy.loginCooldownUntil > now
          ? `Available ${new Date(proxy.loginCooldownUntil).toLocaleString()}`
          : 'Ready for login'}
      </span>
    )
  const over = usage.count > proxy.maxProfiles
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className={cn('font-mono text-xs font-medium', over ? 'text-status-danger' : 'text-ink')}
      >
        {usage.count}/{proxy.maxProfiles}
      </span>
      {usage.profileNames.length > 0 && (
        <span
          className="max-w-[280px] truncate text-[11px] text-subtle-copy"
          title={usage.profileNames.join(', ')}
        >
          {usage.profileNames.join(', ')}
        </span>
      )}
    </div>
  )
}

function ProxyMobileCard({
  proxy,
  usage,
  now,
  onEdit,
  onDelete,
}: {
  proxy: ProxyItem
  usage: ProxyUsage
  now: number
  onEdit: (proxy: ProxyItem) => void
  onDelete: (proxy: ProxyItem) => void
}) {
  return (
    <div
      className={cn(
        'bg-panel-strong rounded-2xl border p-4 shadow-xs',
        'border-line hover:border-line-strong',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold text-ink">{proxy.name}</h3>
            <ProxyTypeBadge proxyType={proxy.proxyType} />
            <ProxyPurposeBadge purpose={proxy.purpose} />
          </div>
          <p className="mt-2 truncate font-mono text-xs text-subtle-copy">
            {maskProxyForDisplay(proxy.proxy)}
          </p>
          {proxy.country && (
            <p className="mt-1 text-xs text-subtle-copy">{proxy.country.toUpperCase()}</p>
          )}
          {proxy.purpose === 'login' && (
            <p className="mt-1 text-xs text-subtle-copy">
              {proxy.loginCooldownUntil && proxy.loginCooldownUntil > now
                ? `Available ${new Date(proxy.loginCooldownUntil).toLocaleString()}`
                : 'Ready for login'}
            </p>
          )}
          {proxy.purpose === 'work' && (
            <p className="mt-1 text-xs text-subtle-copy">
              Usage:{' '}
              <span
                className={cn(
                  'font-mono font-medium',
                  usage.count > proxy.maxProfiles ? 'text-status-danger' : 'text-ink',
                )}
              >
                {usage.count}/{proxy.maxProfiles}
              </span>
              {usage.profileNames.length > 0 && (
                <span className="ml-1">{usage.profileNames.join(', ')}</span>
              )}
            </p>
          )}
        </div>
        <div onClick={(event) => event.stopPropagation()}>
          <ProxyActionsMenu proxy={proxy} onEdit={onEdit} onDelete={onDelete} />
        </div>
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 rounded-full border border-line px-3 text-ink hover:bg-panel-muted"
          onClick={(event) => {
            event.stopPropagation()
            onEdit(proxy)
          }}
        >
          <Pencil className="h-4 w-4" /> Edit
        </Button>
      </div>
    </div>
  )
}

function ProxyDesktopRow({
  proxy,
  usage,
  now,
  idx,
  onEdit,
  onDelete,
}: {
  proxy: ProxyItem
  usage: ProxyUsage
  now: number
  idx: number
  onEdit: (proxy: ProxyItem) => void
  onDelete: (proxy: ProxyItem) => void
}) {
  return (
    <TableRow className={cn('group border-line-soft h-14 border-b hover:bg-panel-subtle')}>
      <TableCell className="pl-4">
        <span className="font-mono text-sm text-subtle-copy">{idx + 1}</span>
      </TableCell>
      <TableCell className="font-medium">
        <span className="text-ink">{proxy.name}</span>
        {proxy.country && (
          <span className="ml-2 text-xs text-subtle-copy">{proxy.country.toUpperCase()}</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          <ProxyTypeBadge proxyType={proxy.proxyType} />
          <ProxyPurposeBadge purpose={proxy.purpose} />
        </div>
      </TableCell>
      <TableCell>
        <span className="font-mono text-xs text-subtle-copy">
          {maskProxyForDisplay(proxy.proxy)}
        </span>
      </TableCell>
      <TableCell>
        <ProxyUsageCell proxy={proxy} usage={usage} now={now} />
      </TableCell>
      <TableCell className="pr-4 text-right">
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-copy hover:bg-panel-muted hover:text-ink"
            onClick={(e) => {
              e.stopPropagation()
              onEdit(proxy)
            }}
            title="Edit Proxy"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <ProxyActionsMenu proxy={proxy} onEdit={onEdit} onDelete={onDelete} />
        </div>
      </TableCell>
    </TableRow>
  )
}

export function ProxiesList({ proxies, usage, loading, onEdit, onDelete }: ProxiesListProps) {
  const isMobile = useIsMobile()
  const cooldownUntil = Math.max(
    0,
    ...proxies
      .filter((proxy) => proxy.purpose === 'login')
      .map((proxy) => proxy.loginCooldownUntil ?? 0),
  )
  const now = useNow(30_000, cooldownUntil)

  if (loading && proxies.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 p-12 text-center text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4 shrink-0" /> Loading proxies...
      </div>
    )
  }

  if (proxies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line-soft bg-panel-subtle p-12 text-center">
        <Globe className="mb-4 h-10 w-10 text-subtle-copy" />
        <h3 className="text-lg font-medium text-ink">No proxies</h3>
        <p className="mt-1 text-sm text-subtle-copy">Add a proxy to reuse it across profiles.</p>
      </div>
    )
  }

  if (isMobile) {
    return (
      <div className="space-y-3">
        {proxies.map((proxy) => (
          <ProxyMobileCard
            key={proxy.id}
            proxy={proxy}
            now={now}
            usage={usage[proxy.id] ?? { count: 0, profileNames: [] }}
            onEdit={onEdit}
            onDelete={onDelete}
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
            <TableHead className="h-12 font-medium text-muted-copy">Name</TableHead>
            <TableHead className="h-12 w-[120px] font-medium text-muted-copy">Type</TableHead>
            <TableHead className="h-12 w-full font-medium text-muted-copy">Proxy</TableHead>
            <TableHead className="h-12 w-[220px] font-medium text-muted-copy">Usage</TableHead>
            <TableHead className="h-12 w-[140px] pr-4 text-right font-medium text-muted-copy">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {proxies.map((proxy, idx) => (
            <ProxyDesktopRow
              key={proxy.id}
              proxy={proxy}
              now={now}
              usage={usage[proxy.id] ?? { count: 0, profileNames: [] }}
              idx={idx}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
