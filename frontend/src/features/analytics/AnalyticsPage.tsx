import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useConvex } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { RefreshCw, UserPlus, Send, Flame, UserCheck } from 'lucide-react'
import { api } from '../../../../convex/_generated/api'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useHeaderToolbarSlot } from '@/components/layout/useHeaderSlot'
import { FollowBackAnalytics } from './FollowBackAnalytics'

type Overview = FunctionReturnType<typeof api.analytics.overview>
type Period = Overview['period']
const periods: Record<Period, string> = {
  today: 'Today',
  '7days': '7 days',
  '30days': '30 days',
  all: 'All time',
}
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const format = (value: number | null) =>
  value === null || !Number.isFinite(value) ? '—' : number.format(value)

function Stat({
  label,
  value,
  detail,
  icon,
}: {
  label: string
  value: number | null
  detail: string
  icon: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-line-soft bg-panel p-4">
      <div className="flex items-center justify-between gap-3 text-sm text-muted-copy">
        {label}
        <span className="text-subtle-copy">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-medium tabular-nums">{format(value)}</p>
      <p className="mt-1 text-xs text-subtle-copy">{detail}</p>
    </div>
  )
}

export function AnalyticsPage() {
  const convex = useConvex()
  const headerSlot = useHeaderToolbarSlot('analytics-header-slot', 300)
  const [period, setPeriod] = useState<Period>('today')
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)
  // Fetch on entry, period changes, and refresh without subscribing to frequent activity writes.
  const load = useCallback(() => {
    const id = ++request.current
    return convex
      .mutation(api.leadStats.initialize, {})
      .then(() => convex.mutation(api.analytics.initialize, {}))
      .then(() =>
        convex.query(api.analytics.overview, {
          date: new Date().toISOString().slice(0, 10),
          period,
        }),
      )
      .then(
        (result) => {
          if (request.current !== id) return
          setData(result)
          setError(null)
          setLoading(false)
        },
        (cause) => {
          if (request.current !== id) return
          setError(cause instanceof Error ? cause.message : 'Could not load analytics.')
          setLoading(false)
        },
      )
  }, [convex, period])
  const refresh = () => {
    setLoading(true)
    setError(null)
    void load()
  }
  useEffect(() => {
    const pending = request
    void load()
    return () => {
      pending.current++
    }
  }, [load])
  const toolbar = (
    <div className="flex items-center gap-2">
      <Select
        value={period}
        onValueChange={(value) => {
          request.current++
          setLoading(true)
          setError(null)
          setData(null)
          setPeriod(value as Period)
        }}
      >
        <SelectTrigger aria-label="Analytics date range" className="h-8 w-32 rounded-xl bg-panel">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(periods).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" onClick={refresh} disabled={loading} className="shrink-0">
        <RefreshCw className={loading ? 'animate-spin' : undefined} />
        {loading ? 'Loading…' : 'Refresh'}
      </Button>
    </div>
  )
  return (
    <div className="flex h-full flex-col overflow-auto bg-shell text-ink">
      {headerSlot && createPortal(toolbar, headerSlot)}
      <div className="mx-auto w-full max-w-[1600px] space-y-3 px-4 py-4 md:px-6">
        {!headerSlot && <div className="flex justify-end">{toolbar}</div>}
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-status-danger-border bg-status-danger-soft p-4 text-sm text-status-danger"
          >
            {error}
            {data && ' Showing the previous snapshot.'}
          </p>
        )}
        {!data && loading && (
          <p role="status" className="py-12 text-center text-sm text-muted-copy">
            Loading workspace metrics…
          </p>
        )}
        {data && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat
                label="Follows"
                value={data.totals.follows}
                detail={`Successful follows · ${periods[data.period]}`}
                icon={<UserPlus className="size-5" />}
              />
              <Stat
                label="DMs sent"
                value={data.totals.dms}
                detail={`Messages sent · ${periods[data.period]}`}
                icon={<Send className="size-5" />}
              />
              <Stat
                label="Warm-up minutes"
                value={data.totals.warmupMinutes}
                detail={`Recorded session time · ${periods[data.period]}`}
                icon={<Flame className="size-5" />}
              />
              <Stat
                label="Assigned to profiles"
                value={data.leads?.assigned ?? null}
                detail="Already reserved for outreach"
                icon={<UserCheck className="size-5" />}
              />
            </div>
            <FollowBackAnalytics data={data.outreach} />
          </>
        )}
      </div>
    </div>
  )
}
