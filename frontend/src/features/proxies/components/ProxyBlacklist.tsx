import { useEffect, useState } from 'react'
import { Ban, RefreshCw } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useIsMobile } from '@/hooks/use-mobile'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type BlacklistedProxy = {
  ip: string
  country: string
  proxyName: string
  reason: string
  createdAt: number
}

export function ProxyBlacklist() {
  const isMobile = useIsMobile()
  const [rows, setRows] = useState<BlacklistedProxy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    apiFetch<BlacklistedProxy[]>('/api/ig-accounts/blacklist')
      .then((result) => {
        if (active) setRows(result)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [reload])

  const retry = () => {
    setError('')
    setLoading(true)
    setReload((value) => value + 1)
  }

  if (loading && rows.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4" /> Loading blacklist...
      </div>
    )
  }

  return (
    <section>
      <div className="mb-2 flex items-center gap-2 px-1">
        <Ban className="h-4 w-4 text-copy" />
        <h2 className="text-base font-semibold text-ink">Proxy blacklist</h2>
        <span className="text-sm text-subtle-copy tabular-nums">{rows.length}</span>
      </div>
      {error && (
        <div
          role="alert"
          className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-status-danger-border bg-status-danger-soft px-4 py-2.5 text-sm text-status-danger"
        >
          <span>{error}</span>
          <Button type="button" variant="outline" onClick={retry}>
            Retry
          </Button>
        </div>
      )}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line-soft bg-panel-subtle p-12 text-center">
          <Ban className="mb-4 h-10 w-10 text-subtle-copy" />
          <h3 className="text-lg font-medium text-ink">No blacklisted proxies</h3>
          <p className="mt-1 text-sm text-subtle-copy">
            Login proxy IPs rejected by Instagram will appear here.
          </p>
        </div>
      ) : isMobile ? (
        <div className="space-y-3">
          {rows.map((row) => (
            <div
              key={row.ip}
              className="rounded-2xl border border-line bg-panel-strong p-4 shadow-xs hover:border-line-strong"
            >
              <h3 className="font-mono text-base font-semibold text-ink">{row.ip}</h3>
              <p className="mt-2 text-xs text-subtle-copy">
                {row.country.toUpperCase()} · {row.proxyName} · {row.reason}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden border border-line-soft bg-panel-subtle shadow-xs">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-line-soft bg-transparent hover:bg-transparent">
                <TableHead className="h-12 w-[80px] pl-4 font-medium text-muted-copy">
                  No.
                </TableHead>
                <TableHead className="h-12 w-[180px] font-medium text-muted-copy">IP</TableHead>
                <TableHead className="h-12 w-[120px] font-medium text-muted-copy">
                  Country
                </TableHead>
                <TableHead className="h-12 w-full font-medium text-muted-copy">Proxy</TableHead>
                <TableHead className="h-12 w-[220px] pr-4 font-medium text-muted-copy">
                  Reason
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow
                  key={row.ip}
                  className="h-14 border-b border-line-soft hover:bg-panel-subtle"
                >
                  <TableCell className="pl-4">
                    <span className="font-mono text-sm text-subtle-copy">{index + 1}</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-sm text-ink">{row.ip}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-copy">{row.country.toUpperCase()}</span>
                  </TableCell>
                  <TableCell>
                    <span className="block max-w-[280px] truncate text-sm text-subtle-copy">
                      {row.proxyName}
                    </span>
                  </TableCell>
                  <TableCell className="pr-4">
                    <span className="text-xs text-subtle-copy">{row.reason}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}
