import { Cpu, HardDrive, MemoryStick } from 'lucide-react'
import { AmbientGlow } from '@/components/ui/ambient-glow'
import { Badge } from '@/components/ui/badge'
import { useMonitoringData } from '../hooks/useMonitoringData'
import { MetricCard } from '../components/MonitoringShared'
import { MonitoringSkeleton } from '../components/MonitoringSkeleton'
import { FatalErrorState } from '../components/FatalErrorState'
import { SystemInfoSection } from '../components/SystemInfoSection'
import { NetworkSection } from '../components/NetworkSection'

export function MonitoringPageContainer() {
  const { data, loading, error, lastUpdate, retrying, handleRetry } =
    useMonitoringData()

  if (loading) return <MonitoringSkeleton />
  if (error && !data) {
    return (
      <FatalErrorState
        error={error}
        onRetry={() => void handleRetry()}
        retrying={retrying}
      />
    )
  }
  if (!data) return null

  const staleData = Boolean(error)

  return (
    <div className="bg-shell text-ink relative flex h-full flex-col overflow-hidden">
      <AmbientGlow />

      <MonitoringHeader
        staleData={staleData}
        lastUpdate={lastUpdate}
        error={error}
      />

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
            <SystemInfoSection data={data} />
            <NetworkSection data={data} />
          </div>
        </div>
      </div>
    </div>
  )
}

function MonitoringHeader({
  staleData,
  lastUpdate,
  error,
}: {
  staleData: boolean
  lastUpdate: Date | null
  error: string | null
}) {
  return (
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
  )
}
