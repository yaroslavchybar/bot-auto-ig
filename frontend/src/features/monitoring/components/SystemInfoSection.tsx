import { Clock, Server } from 'lucide-react'
import { SectionCard } from './MonitoringShared'
import type { MonitoringData } from '../hooks/useMonitoringData'

export function SystemInfoSection({ data }: { data: MonitoringData }) {
  const items = [
    { label: 'Hostname', value: data.system.hostname },
    { label: 'Platform', value: data.system.platform },
    { label: 'Architecture', value: data.system.arch },
    { label: 'Kernel', value: data.system.release, title: data.system.release },
    { label: 'CPU Model', value: data.cpu.model, title: data.cpu.model },
    { label: 'Uptime', value: data.system.uptimeFormatted, icon: Clock },
  ]

  return (
    <SectionCard
      title="System Information"
      icon={Server}
      description="Host identity and runtime details for the active machine."
    >
      <div className="space-y-3">
        {items.map((item) => (
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
  )
}
