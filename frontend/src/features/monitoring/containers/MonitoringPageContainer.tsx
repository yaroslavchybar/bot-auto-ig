import {
  useCallback,
  useEffect,
  useState,
  type ElementType,
  type ReactNode,
} from 'react'
import {
  Activity,
  Clock,
  Cpu,
  HardDrive,
  MemoryStick,
  RefreshCw,
  Server,
  Wifi,
} from 'lucide-react'
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
      badgeClassName:
        'bg-status-danger-soft text-status-danger border-status-danger-border',
      indicatorClassName: 'status-dot-danger',
      progressClassName:
        'bg-panel-muted [&>div]:bg-status-danger [&>div]:status-glow-danger',
      valueClassName: 'text-status-danger',
      label: 'Critical',
    }
  }

  if (percent >= 60) {
    return {
      badgeClassName:
        'bg-status-warning-soft text-status-warning border-status-warning-border',
      indicatorClassName: 'status-dot-warning',
      progressClassName:
        'bg-panel-muted [&>div]:bg-status-warning [&>div]:status-glow-warning',
      valueClassName: 'text-status-warning',
      label: 'Warning',
    }
  }

  return {
    badgeClassName:
      'bg-status-success-soft text-status-success border-status-success-border',
    indicatorClassName: 'status-dot-success',
    progressClassName:
      'bg-panel-muted [&>div]:bg-status-success [&>div]:status-glow-success',
    valueClassName: 'text-status-success',
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
    <Card className="border-line-soft bg-panel-subtle rounded-2xl border shadow-xs backdrop-blur-xs">
      <CardHeader className="border-line-soft gap-3 border-b pb-4">
        <div className="flex items-start gap-3">
          <div className="border-line bg-panel-soft text-copy flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-ink text-sm font-medium">
              {title}
            </CardTitle>
            {description ? (
              <p className="text-subtle-copy mt-1 text-sm">{description}</p>
            ) : null}
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
    <Card className="border-line-soft bg-panel-subtle rounded-2xl border shadow-xs backdrop-blur-xs">
      <CardHeader className="gap-4 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="border-line bg-panel-soft text-copy flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-ink text-sm font-medium">
                {title}
              </CardTitle>
              <p className="text-subtle-copy mt-1 text-xs">{detail}</p>
            </div>
          </div>
          <Badge
            className={`shrink-0 border text-xs font-medium ${tone.badgeClassName}`}
          >
            {tone.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="flex items-end justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={`text-4xl font-semibold tracking-tight tabular-nums ${tone.valueClassName}`}
            >
              {percent}%
            </span>
            <span
              className={`h-2.5 w-2.5 rounded-full ${tone.indicatorClassName}`}
            />
          </div>
        </div>
        <Progress
          value={percent}
          className={`h-2.5 rounded-full ${tone.progressClassName}`}
        />
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Used', value: used },
            { label: 'Free', value: free },
            { label: 'Total', value: total },
          ].map((item) => (
            <div
              key={item.label}
              className="border-line-soft bg-panel-muted rounded-xl border px-3 py-3"
            >
              <div className="text-subtle-copy text-[11px] tracking-[0.16em] uppercase">
                {item.label}
              </div>
              <div className="text-ink mt-2 text-sm font-medium">
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function MonitoringSkeleton() {
  return (
    <div className="bg-shell text-ink relative flex h-full flex-col overflow-hidden">
      <AmbientGlow />

      <div className="mobile-effect-blur border-line-soft bg-panel-subtle sticky top-0 z-10 shrink-0 border-b px-4 pt-2 pb-2 backdrop-blur-xs md:px-6 md:pt-3 md:pb-3">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <Skeleton className="bg-panel-hover h-8 w-48" />
              <Skeleton className="bg-panel-hover h-4 w-72 max-w-full" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Skeleton className="bg-panel-hover h-7 w-20 rounded-full" />
              <Skeleton className="bg-panel-hover h-7 w-32 rounded-full" />
            </div>
          </div>
        </div>
      </div>

      <div className="relative z-10 flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
        <div className="space-y-6">
          <div className="grid gap-4 xl:grid-cols-3">
            {[1, 2, 3].map((item) => (
              <Card
                key={item}
                className="border-line-soft bg-panel-subtle rounded-2xl border shadow-xs backdrop-blur-xs"
              >
                <CardHeader className="gap-4 pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Skeleton className="bg-panel-hover h-11 w-11 rounded-xl" />
                      <div className="space-y-2">
                        <Skeleton className="bg-panel-hover h-4 w-24" />
                        <Skeleton className="bg-panel-hover h-3 w-20" />
                      </div>
                    </div>
                    <Skeleton className="bg-panel-hover h-6 w-20 rounded-full" />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-0">
                  <Skeleton className="bg-panel-hover h-10 w-20" />
                  <Skeleton className="bg-panel-hover h-2.5 w-full rounded-full" />
                  <div className="grid grid-cols-3 gap-3">
                    {[1, 2, 3].map((stat) => (
                      <Skeleton
                        key={stat}
                        className="bg-panel-hover h-[72px] rounded-xl"
                      />
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
                className="border-line-soft bg-panel-subtle rounded-2xl border shadow-xs backdrop-blur-xs"
              >
                <CardHeader className="border-line-soft gap-3 border-b pb-4">
                  <div className="flex items-start gap-3">
                    <Skeleton className="bg-panel-hover h-10 w-10 rounded-xl" />
                    <div className="space-y-2">
                      <Skeleton className="bg-panel-hover h-4 w-32" />
                      <Skeleton className="bg-panel-hover h-4 w-48" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-5">
                  {[1, 2, 3, 4].map((row) => (
                    <Skeleton
                      key={row}
                      className="bg-panel-hover h-12 rounded-xl"
                    />
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
  retrying,
}: {
  error: string
  onRetry: () => void
  retrying: boolean
}) {
  return (
    <div className="bg-shell relative flex h-full items-center justify-center p-4 md:p-6">
      <AmbientGlow />
      <Card className="border-line bg-panel relative z-10 w-full max-w-md rounded-2xl border shadow-xl backdrop-blur-xl">
        <CardContent className="space-y-6 p-6 text-center">
          <div className="border-status-danger-border bg-status-danger-soft mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border">
            <RefreshCw className="text-status-danger h-5 w-5" />
          </div>
          <div className="space-y-2">
            <h2 className="page-title-gradient text-2xl font-bold tracking-tight">
              Monitoring unavailable
            </h2>
            <p className="text-muted-copy text-sm">{error}</p>
          </div>
          <Button onClick={onRetry} disabled={retrying} className="brand-button w-full">
            <RefreshCw className={retrying ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            Retry
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export function MonitoringPageContainer() {
  const performanceMode = usePerformanceMode()
  const isVisible = useDocumentVisibility()
  const [data, setData] = useState<MonitoringData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [retrying, setRetrying] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const endpoint = env.isDev
        ? `${env.apiUrl}/api/monitoring`
        : '/api/monitoring'
      const result = await apiFetch<MonitoringData>(endpoint)
      setData(result)
      setLastUpdate(new Date())
      setError(null)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to fetch monitoring data',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  const handleRetry = useCallback(async () => {
    setRetrying(true)
    try {
      await fetchData()
    } finally {
      setRetrying(false)
    }
  }, [fetchData])

  useEffect(() => {
    if (!isVisible) {
      return
    }

    fetchData()
    const interval = setInterval(
      fetchData,
      performanceMode ? MOBILE_POLL_INTERVAL : POLL_INTERVAL,
    )
    return () => clearInterval(interval)
  }, [fetchData, isVisible, performanceMode])

  if (loading) {
    return <MonitoringSkeleton />
  }

  if (error && !data) {
    return <FatalErrorState error={error} onRetry={() => void handleRetry()} retrying={retrying} />
  }

  if (!data) {
    return null
  }

  const externalInterfaces = Object.entries(data.network).flatMap(
    ([name, addresses]) =>
      addresses
        .filter((address) => !address.internal && address.family === 'IPv4')
        .map((address) => ({ name, ...address })),
  )

  const staleData = Boolean(error)

  return (
    <div className="bg-shell text-ink relative flex h-full flex-col overflow-hidden">
      <AmbientGlow />

      <div className="relative z-10 flex-none px-4 pt-2 pb-2 md:px-6 md:pt-3 md:pb-3">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-end">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge
                className={`border px-2.5 py-1 font-medium ${
                  staleData
                    ? 'bg-status-danger-soft text-status-danger border-status-danger-border'
                    : 'bg-status-success-soft text-status-success border-status-success-border'
                }`}
              >
                <span
                  className={`mr-2 h-2 w-2 rounded-full ${staleData ? 'status-dot-danger' : 'status-dot-success'}`}
                />
                {staleData ? 'Cached data' : 'Live'}
              </Badge>
              {lastUpdate ? (
                <Badge className="border-line text-copy border bg-transparent px-2.5 py-1 font-medium">
                  Updated {lastUpdate.toLocaleTimeString()}
                </Badge>
              ) : null}
              {staleData ? (
                <Badge className="border-status-danger-border bg-status-danger-soft text-status-danger max-w-full border px-2.5 py-1 font-medium">
                  {error}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>

      <div className="relative z-10 flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
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
                  {
                    label: 'Kernel',
                    value: data.system.release,
                    title: data.system.release,
                  },
                  {
                    label: 'CPU Model',
                    value: data.cpu.model,
                    title: data.cpu.model,
                  },
                  {
                    label: 'Uptime',
                    value: data.system.uptimeFormatted,
                    icon: Clock,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="border-line-soft bg-panel-muted flex flex-col gap-2 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    title={item.title}
                  >
                    <div className="text-muted-copy flex items-center gap-2 text-sm">
                      {item.icon ? (
                        <item.icon className="text-subtle-copy h-3.5 w-3.5" />
                      ) : null}
                      <span>{item.label}</span>
                    </div>
                    <span className="text-ink max-w-full truncate font-mono text-sm sm:ml-6">
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
                <div className="border-line bg-panel-subtle rounded-2xl border border-dashed px-4 py-10 text-center">
                  <p className="text-muted-copy text-sm">
                    No external IPv4 interfaces found.
                  </p>
                  <p className="text-subtle-copy mt-2 text-xs">
                    Internal-only adapters are hidden to keep this view
                    operationally useful.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {externalInterfaces.map((iface) => (
                    <div
                      key={`${iface.name}-${iface.address}`}
                      className="border-line-soft bg-panel-soft hover:bg-panel-selected rounded-2xl border p-4 transition-colors"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="text-ink flex items-center gap-2 text-sm font-medium">
                            <Activity className="text-status-success h-3.5 w-3.5" />
                            <span className="truncate">{iface.name}</span>
                          </div>
                          <p className="text-subtle-copy mt-1 text-xs">
                            External address mapping
                          </p>
                        </div>
                        <Badge className="border-line text-copy w-fit border bg-transparent">
                          IPv4
                        </Badge>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {[
                          { label: 'IP Address', value: iface.address },
                          { label: 'MAC Address', value: iface.mac },
                          {
                            label: 'Netmask',
                            value: iface.netmask,
                            span: 'sm:col-span-2',
                          },
                        ].map((field) => (
                          <div
                            key={`${iface.name}-${field.label}`}
                            className={`border-line-soft bg-panel-muted rounded-xl border px-3 py-3 ${field.span ?? ''}`}
                          >
                            <div className="text-subtle-copy text-[11px] tracking-[0.16em] uppercase">
                              {field.label}
                            </div>
                            <div className="text-ink mt-2 font-mono text-sm break-all">
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



