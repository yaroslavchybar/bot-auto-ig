import { useCallback, useEffect, useState, type ElementType, type ReactNode } from 'react'
import { Activity, Clock, Cpu, HardDrive, MemoryStick, RefreshCw, Server, Wifi } from 'lucide-react'
import { AmbientGlow } from '@/components/ui/ambient-glow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { useDocumentVisibility } from '@/hooks/use-document-visibility'
import { usePerformanceMode } from '@/hooks/use-performance-mode'
import { apiFetch } from '@/lib/api'
import { env } from '@/lib/env'

const POLL_INTERVAL = 5000
const MOBILE_POLL_INTERVAL = 20000

interface MonitoringData {
  cpu: { percent: number; cores: number; model: string }
  memory: {
    total: number
    used: number
    free: number
    percent: number
    totalFormatted: string
    usedFormatted: string
    freeFormatted: string
  }
  disk: {
    total: number
    used: number
    free: number
    percent: number
    totalFormatted: string
    usedFormatted: string
    freeFormatted: string
  }
  system: {
    hostname: string
    platform: string
    arch: string
    release: string
    uptime: number
    uptimeFormatted: string
  }
  network: Record<
    string,
    Array<{
      address: string
      netmask: string
      family: string
      mac: string
      internal: boolean
    }>
  >
  timestamp: string
}

type MetricTone = {
  badgeClassName: string
  indicatorClassName: string
  progressClassName: string
  valueClassName: string
  label: 'Healthy' | 'Warning' | 'Critical'
}

function getMetricTone(percent: number): MetricTone {
  if (percent >= 80) {
    return {
      badgeClassName: 'bg-red-500/10 text-red-400 border-red-500/20',
      indicatorClassName: 'bg-red-400',
      progressClassName: 'bg-white/5 [&>div]:bg-red-500 [&>div]:shadow-[0_0_10px_rgba(239,68,68,0.28)]',
      valueClassName: 'text-red-400',
      label: 'Critical',
    }
  }

  if (percent >= 60) {
    return {
      badgeClassName: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
      indicatorClassName: 'bg-orange-400',
      progressClassName: 'bg-white/5 [&>div]:bg-orange-500 [&>div]:shadow-[0_0_10px_rgba(249,115,22,0.24)]',
      valueClassName: 'text-orange-400',
      label: 'Warning',
    }
  }

  return {
    badgeClassName: 'bg-green-500/10 text-green-400 border-green-500/20',
    indicatorClassName: 'bg-green-400',
    progressClassName: 'bg-white/5 [&>div]:bg-green-500 [&>div]:shadow-[0_0_10px_rgba(34,197,94,0.22)]',
    valueClassName: 'text-green-400',
    label: 'Healthy',
  }
}

function SectionCard({
  title,
  icon: Icon,
  description,
  children,
}: {
  title: string
  icon: ElementType
  description?: string
  children: ReactNode
}) {
  return (
    <Card className="border border-white/[0.05] bg-white/[0.02] rounded-2xl backdrop-blur-xs shadow-xs">
      <CardHeader className="gap-3 border-b border-white/[0.05] pb-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-gray-300">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-sm font-medium text-gray-200">{title}</CardTitle>
            {description ? <p className="mt-1 text-sm text-gray-500">{description}</p> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-5">{children}</CardContent>
    </Card>
  )
}

function MetricCard({
  title,
  icon: Icon,
  percent,
  used,
  free,
  total,
  detail,
}: {
  title: string
  icon: ElementType
  percent: number
  used: string
  free: string
  total: string
  detail: string
}) {
  const tone = getMetricTone(percent)

  return (
    <Card className="border border-white/[0.05] bg-white/[0.02] rounded-2xl backdrop-blur-xs shadow-xs">
      <CardHeader className="gap-4 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-gray-300">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm font-medium text-gray-200">{title}</CardTitle>
              <p className="mt-1 text-xs text-gray-500">{detail}</p>
            </div>
          </div>
          <Badge className={`shrink-0 border text-xs font-medium ${tone.badgeClassName}`}>
            {tone.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="flex items-end justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`text-4xl font-semibold tracking-tight tabular-nums ${tone.valueClassName}`}>
              {percent}%
            </span>
            <span className={`h-2.5 w-2.5 rounded-full ${tone.indicatorClassName}`} />
          </div>
        </div>
        <Progress value={percent} className={`h-2.5 rounded-full ${tone.progressClassName}`} />
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Used', value: used },
            { label: 'Free', value: free },
            { label: 'Total', value: total },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-white/[0.05] bg-black/30 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">{item.label}</div>
              <div className="mt-2 text-sm font-medium text-gray-200">{item.value}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function MonitoringSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#050505] text-gray-200 relative">
      <AmbientGlow />

      <div className="mobile-effect-blur sticky top-0 z-10 border-b border-white/5 bg-white/[0.02] backdrop-blur-xs shrink-0">
        <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <Skeleton className="h-8 w-48 bg-white/10" />
              <Skeleton className="h-4 w-72 max-w-full bg-white/10" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-7 w-20 rounded-full bg-white/10" />
              <Skeleton className="h-7 w-32 rounded-full bg-white/10" />
            </div>
          </div>
        </div>
      </div>

      <div className="relative z-10 flex-1 overflow-auto p-4 md:p-6">
        <div className="space-y-6">
          <div className="grid gap-4 xl:grid-cols-3">
            {[1, 2, 3].map((item) => (
              <Card
                key={item}
                className="border border-white/[0.05] bg-white/[0.02] rounded-2xl backdrop-blur-xs shadow-xs"
              >
                <CardHeader className="gap-4 pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-11 w-11 rounded-xl bg-white/10" />
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-24 bg-white/10" />
                        <Skeleton className="h-3 w-20 bg-white/10" />
                      </div>
                    </div>
                    <Skeleton className="h-6 w-20 rounded-full bg-white/10" />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-0">
                  <Skeleton className="h-10 w-20 bg-white/10" />
                  <Skeleton className="h-2.5 w-full rounded-full bg-white/10" />
                  <div className="grid grid-cols-3 gap-3">
                    {[1, 2, 3].map((stat) => (
                      <Skeleton key={stat} className="h-[72px] rounded-xl bg-white/10" />
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {[1, 2].map((item) => (
              <Card
                key={item}
                className="border border-white/[0.05] bg-white/[0.02] rounded-2xl backdrop-blur-xs shadow-xs"
              >
                <CardHeader className="gap-3 border-b border-white/[0.05] pb-4">
                  <div className="flex items-start gap-3">
                    <Skeleton className="h-10 w-10 rounded-xl bg-white/10" />
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-32 bg-white/10" />
                      <Skeleton className="h-4 w-48 bg-white/10" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-5">
                  {[1, 2, 3, 4].map((row) => (
                    <Skeleton key={row} className="h-12 rounded-xl bg-white/10" />
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function FatalErrorState({
  error,
  onRetry,
}: {
  error: string
  onRetry: () => void
}) {
  return (
    <div className="flex h-full items-center justify-center bg-[#050505] p-4 md:p-6 relative">
      <AmbientGlow />
      <Card className="relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0a0a] backdrop-blur-xl shadow-xl">
        <CardContent className="space-y-6 p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10">
            <RefreshCw className="h-5 w-5 text-red-400" />
          </div>
          <div className="space-y-2">
            <h2 className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-2xl font-bold tracking-tight text-transparent">
              Monitoring unavailable
            </h2>
            <p className="text-sm text-gray-400">{error}</p>
          </div>
          <Button
            onClick={onRetry}
            className="w-full bg-gradient-to-r from-red-600 to-orange-500 text-white border-0 shadow-[0_0_15px_rgba(239,68,68,0.4)] transition-all hover:from-red-500 hover:to-orange-400 hover:shadow-[0_0_25px_rgba(239,68,68,0.6)]"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export function MonitoringPage() {
  const performanceMode = usePerformanceMode()
  const isVisible = useDocumentVisibility()
  const [data, setData] = useState<MonitoringData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const endpoint = env.isDev ? `${env.apiUrl}/api/monitoring` : '/api/monitoring'
      const result = await apiFetch<MonitoringData>(endpoint)
      setData(result)
      setLastUpdate(new Date())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch monitoring data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isVisible) {
      return
    }

    fetchData()
    const interval = setInterval(fetchData, performanceMode ? MOBILE_POLL_INTERVAL : POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchData, isVisible, performanceMode])

  if (loading) {
    return <MonitoringSkeleton />
  }

  if (error && !data) {
    return <FatalErrorState error={error} onRetry={() => void fetchData()} />
  }

  if (!data) {
    return null
  }

  const externalInterfaces = Object.entries(data.network).flatMap(([name, addresses]) =>
    addresses
      .filter((address) => !address.internal && address.family === 'IPv4')
      .map((address) => ({ name, ...address }))
  )

  const staleData = Boolean(error)

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#050505] text-gray-200 relative">
      <AmbientGlow />

      <div className="mobile-effect-blur sticky top-0 z-10 shrink-0 border-b border-white/5 bg-white/[0.02] backdrop-blur-xs">
        <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <h2 className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-2xl font-bold tracking-tight text-transparent md:text-3xl">
                VPS Monitor
              </h2>
              <p className="mt-1 text-sm text-gray-400">
                Track live host resource usage and network availability.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge
                className={`border px-2.5 py-1 font-medium ${
                  staleData
                    ? 'bg-red-500/10 text-red-400 border-red-500/20'
                    : 'bg-green-500/10 text-green-400 border-green-500/20'
                }`}
              >
                <span className={`mr-2 h-2 w-2 rounded-full ${staleData ? 'bg-red-400' : 'bg-green-400'}`} />
                {staleData ? 'Cached data' : 'Live'}
              </Badge>
              {lastUpdate ? (
                <Badge className="border border-white/10 bg-transparent px-2.5 py-1 font-medium text-gray-300">
                  Updated {lastUpdate.toLocaleTimeString()}
                </Badge>
              ) : null}
              {staleData ? (
                <Badge className="max-w-full border border-red-500/20 bg-red-500/10 px-2.5 py-1 font-medium text-red-300">
                  {error}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="relative z-10 flex-1 overflow-auto p-4 md:p-6">
        <div className="space-y-6">
          <div className="grid gap-4 xl:grid-cols-3">
            <MetricCard
              title="CPU Usage"
              icon={Cpu}
              percent={data.cpu.percent}
              used={`${data.cpu.percent}%`}
              free={`${100 - data.cpu.percent}%`}
              total={`${data.cpu.cores} cores`}
              detail={data.cpu.model}
            />
            <MetricCard
              title="Memory"
              icon={MemoryStick}
              percent={data.memory.percent}
              used={data.memory.usedFormatted}
              free={data.memory.freeFormatted}
              total={data.memory.totalFormatted}
              detail="Physical memory allocation"
            />
            <MetricCard
              title="Disk"
              icon={HardDrive}
              percent={data.disk.percent}
              used={data.disk.usedFormatted}
              free={data.disk.freeFormatted}
              total={data.disk.totalFormatted}
              detail="Primary volume consumption"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard
              title="System Information"
              icon={Server}
              description="Host identity and runtime details for the active machine."
            >
              <div className="space-y-3">
                {[
                  { label: 'Hostname', value: data.system.hostname },
                  { label: 'Platform', value: data.system.platform },
                  { label: 'Architecture', value: data.system.arch },
                  { label: 'Kernel', value: data.system.release, title: data.system.release },
                  { label: 'CPU Model', value: data.cpu.model, title: data.cpu.model },
                  { label: 'Uptime', value: data.system.uptimeFormatted, icon: Clock },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex flex-col gap-2 rounded-xl border border-white/[0.05] bg-black/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    title={item.title}
                  >
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      {item.icon ? <item.icon className="h-3.5 w-3.5 text-gray-500" /> : null}
                      <span>{item.label}</span>
                    </div>
                    <span className="max-w-full truncate font-mono text-sm text-gray-200 sm:ml-6">
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard
              title="Network Interfaces"
              icon={Wifi}
              description="External IPv4 interfaces currently reported by the host."
            >
              {externalInterfaces.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.01] px-4 py-10 text-center">
                  <p className="text-sm text-gray-400">No external IPv4 interfaces found.</p>
                  <p className="mt-2 text-xs text-gray-500">
                    Internal-only adapters are hidden to keep this view operationally useful.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {externalInterfaces.map((iface) => (
                    <div
                      key={`${iface.name}-${iface.address}`}
                      className="rounded-2xl border border-white/[0.05] bg-white/[0.03] p-4 transition-colors hover:bg-white/[0.04]"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
                            <Activity className="h-3.5 w-3.5 text-green-400" />
                            <span className="truncate">{iface.name}</span>
                          </div>
                          <p className="mt-1 text-xs text-gray-500">External address mapping</p>
                        </div>
                        <Badge className="w-fit border border-white/10 bg-transparent text-gray-300">
                          IPv4
                        </Badge>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {[
                          { label: 'IP Address', value: iface.address },
                          { label: 'MAC Address', value: iface.mac },
                          { label: 'Netmask', value: iface.netmask, span: 'sm:col-span-2' },
                        ].map((field) => (
                          <div
                            key={`${iface.name}-${field.label}`}
                            className={`rounded-xl border border-white/[0.05] bg-black/30 px-3 py-3 ${field.span ?? ''}`}
                          >
                            <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">
                              {field.label}
                            </div>
                            <div className="mt-2 break-all font-mono text-sm text-gray-200">
                              {field.value}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      </div>
    </div>
  )
}
