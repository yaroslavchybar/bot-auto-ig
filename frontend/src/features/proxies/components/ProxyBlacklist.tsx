import { useEffect, useState } from 'react'
import { Ban, RefreshCw } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useIsMobile } from '@/hooks/use-mobile'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
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
      .then((result) => { if (active) setRows(result) })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [reload])

  const retry = () => {
    setError('')
    setLoading(true)
    setReload((value) => value + 1)
  }

  if (loading && rows.length === 0) {
    return <div className="text-muted-foreground flex animate-pulse items-center justify-center gap-2 p-12 text-sm"><RefreshCw className="h-4 w-4 animate-spin" /> Loading blacklist...</div>
  }

  return (
    <section>
      <div className="mb-2 flex items-center gap-2 px-1">
        <Ban className="text-copy h-4 w-4" />
        <h2 className="text-ink text-base font-semibold">Proxy blacklist</h2>
        <span className="text-subtle-copy text-sm tabular-nums">{rows.length}</span>
      </div>
      {error && (
        <div role="alert" className="text-status-danger bg-status-danger-soft border-status-danger-border mb-3 flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm">
          <span>{error}</span>
          <Button type="button" size="sm" variant="outline" onClick={retry}>Retry</Button>
        </div>
      )}
      {rows.length === 0 ? (
        <div className="border-line-soft bg-panel-subtle flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 text-center">
          <Ban className="text-subtle-copy mb-4 h-10 w-10" />
          <h3 className="text-ink text-lg font-medium">No blacklisted proxies</h3>
          <p className="text-subtle-copy mt-1 text-sm">Login proxy IPs rejected by Instagram will appear here.</p>
        </div>
      ) : isMobile ? (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.ip} className="bg-panel-strong border-line hover:border-line-strong rounded-2xl border p-4 shadow-xs transition-colors">
              <h3 className="text-ink font-mono text-base font-semibold">{row.ip}</h3>
              <p className="text-subtle-copy mt-2 text-xs">{row.country.toUpperCase()} · {row.proxyName} · {row.reason}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-panel-subtle border-line-soft overflow-hidden rounded-2xl border shadow-xs backdrop-blur-xs">
          <Table>
            <TableHeader>
              <TableRow className="border-line-soft border-b bg-transparent hover:bg-transparent">
                <TableHead className="text-muted-copy h-12 w-[80px] pl-4 font-medium">No.</TableHead>
                <TableHead className="text-muted-copy h-12 w-[180px] font-medium">IP</TableHead>
                <TableHead className="text-muted-copy h-12 w-[120px] font-medium">Country</TableHead>
                <TableHead className="text-muted-copy h-12 w-full font-medium">Proxy</TableHead>
                <TableHead className="text-muted-copy h-12 w-[220px] pr-4 font-medium">Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={row.ip} className="border-line-soft h-14 border-b transition-colors hover:bg-panel-subtle">
                  <TableCell className="pl-4"><span className="text-subtle-copy font-mono text-sm">{index + 1}</span></TableCell>
                  <TableCell><span className="text-ink font-mono text-sm">{row.ip}</span></TableCell>
                  <TableCell><span className="text-copy text-sm">{row.country.toUpperCase()}</span></TableCell>
                  <TableCell><span className="text-subtle-copy block max-w-[280px] truncate text-sm">{row.proxyName}</span></TableCell>
                  <TableCell className="pr-4"><span className="text-subtle-copy text-xs">{row.reason}</span></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}
