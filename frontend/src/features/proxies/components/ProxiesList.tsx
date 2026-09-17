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
          className="text-muted-copy hover:bg-panel-muted h-8 w-8 p-0 hover:text-ink"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="panel-dropdown w-48"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuLabel className="text-muted-copy">Actions</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => onEdit(proxy)}
          className="hover:bg-panel-hover focus:bg-panel-hover cursor-pointer"
        >
          <Pencil className="mr-2 h-4 w-4" /> Edit Proxy
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onDelete(proxy)}
          className="text-status-danger focus:text-status-danger focus:bg-status-danger-soft hover:bg-status-danger-soft cursor-pointer"
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

function ProxyUsageCell({ proxy, usage }: { proxy: ProxyItem; usage: ProxyUsage }) {
  const over = usage.count > proxy.maxProfiles
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className={cn(
          'font-mono text-xs font-medium',
          over ? 'text-status-danger' : 'text-ink',
        )}
      >
        {usage.count}/{proxy.maxProfiles}
      </span>
      {usage.profileNames.length > 0 && (
        <span
          className="text-subtle-copy max-w-[280px] truncate text-[11px]"
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
  onEdit,
  onDelete,
}: {
  proxy: ProxyItem
  usage: ProxyUsage
  onEdit: (proxy: ProxyItem) => void
  onDelete: (proxy: ProxyItem) => void
}) {
  return (
    <div
      className={cn(
        'bg-panel-strong rounded-2xl border p-4 shadow-xs transition-colors',
        'border-line hover:border-line-strong',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-ink truncate text-base font-semibold">{proxy.name}</h3>
            <ProxyTypeBadge proxyType={proxy.proxyType} />
          </div>
          <p className="text-subtle-copy mt-2 truncate font-mono text-xs">
            {maskProxyForDisplay(proxy.proxy)}
          </p>
          <p className="text-subtle-copy mt-1 text-xs">
            Usage:{' '}
            <span className={cn('font-mono font-medium', usage.count > proxy.maxProfiles ? 'text-status-danger' : 'text-ink')}>
              {usage.count}/{proxy.maxProfiles}
            </span>
            {usage.profileNames.length > 0 && (
              <span className="ml-1">{usage.profileNames.join(', ')}</span>
            )}
          </p>
        </div>
        <div onClick={(event) => event.stopPropagation()}>
          <ProxyActionsMenu proxy={proxy} onEdit={onEdit} onDelete={onDelete} />
        </div>
      </div>
      <div className="border-line mt-4 border-t pt-3">
        <Button
          variant="ghost"
          size="sm"
          className="border-line text-ink hover:bg-panel-muted h-9 rounded-full border px-3"
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
  idx,
  onEdit,
  onDelete,
}: {
  proxy: ProxyItem
  usage: ProxyUsage
  idx: number
  onEdit: (proxy: ProxyItem) => void
  onDelete: (proxy: ProxyItem) => void
}) {
  return (
    <TableRow
      className={cn('group border-line-soft h-14 border-b transition-colors hover:bg-panel-subtle')}
    >
      <TableCell className="pl-4">
        <span className="text-subtle-copy font-mono text-sm">{idx + 1}</span>
      </TableCell>
      <TableCell className="font-medium">
        <span className="text-ink">{proxy.name}</span>
      </TableCell>
      <TableCell>
        <ProxyTypeBadge proxyType={proxy.proxyType} />
      </TableCell>
      <TableCell>
        <span className="text-subtle-copy font-mono text-xs">
          {maskProxyForDisplay(proxy.proxy)}
        </span>
      </TableCell>
      <TableCell>
        <ProxyUsageCell proxy={proxy} usage={usage} />
      </TableCell>
      <TableCell className="pr-4 text-right">
        <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-copy hover:bg-panel-muted h-8 w-8 hover:text-ink"
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

  if (loading && proxies.length === 0) {
    return (
      <div className="text-muted-foreground flex animate-pulse items-center justify-center gap-2 p-12 text-center text-sm">
        <RefreshCw className="h-4 w-4 shrink-0 animate-spin" /> Loading proxies...
      </div>
    )
  }

  if (proxies.length === 0) {
    return (
      <div className="border-line-soft bg-panel-subtle flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 text-center">
        <Globe className="text-subtle-copy mb-4 h-10 w-10" />
        <h3 className="text-ink text-lg font-medium">No proxies</h3>
        <p className="text-subtle-copy mt-1 text-sm">
          Add a proxy to reuse it across profiles.
        </p>
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
            usage={usage[proxy.id] ?? { count: 0, profileNames: [] }}
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
            <TableHead className="text-muted-copy h-12 w-[80px] pl-4 font-medium">No.</TableHead>
            <TableHead className="text-muted-copy h-12 font-medium">Name</TableHead>
            <TableHead className="text-muted-copy h-12 w-[120px] font-medium">Type</TableHead>
            <TableHead className="text-muted-copy h-12 w-full font-medium">Proxy</TableHead>
            <TableHead className="text-muted-copy h-12 w-[220px] font-medium">Usage</TableHead>
            <TableHead className="text-muted-copy h-12 w-[140px] pr-4 text-right font-medium">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {proxies.map((proxy, idx) => (
            <ProxyDesktopRow
              key={proxy.id}
              proxy={proxy}
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
