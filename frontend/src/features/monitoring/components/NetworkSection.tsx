import { Activity, Wifi } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { SectionCard } from './MonitoringShared'
import type { MonitoringData } from '../hooks/useMonitoringData'

export function NetworkSection({ data }: { data: MonitoringData }) {
  const externalInterfaces = Object.entries(data.network).flatMap(
    ([name, addresses]) =>
      addresses
        .filter((address) => !address.internal && address.family === 'IPv4')
        .map((address) => ({ name, ...address })),
  )

  return (
    <SectionCard
      title="Network Interfaces"
      icon={Wifi}
      description="External IPv4 interfaces currently reported by the host."
    >
      {externalInterfaces.length === 0 ? (
        <NetworkEmptyState />
      ) : (
        <div className="space-y-3">
          {externalInterfaces.map((iface) => (
            <NetworkInterfaceCard key={`${iface.name}-${iface.address}`} iface={iface} />
          ))}
        </div>
      )}
    </SectionCard>
  )
}

function NetworkEmptyState() {
  return (
    <div className="border-line bg-panel-subtle rounded-2xl border border-dashed px-4 py-10 text-center">
      <p className="text-muted-copy text-sm">
        No external IPv4 interfaces found.
      </p>
      <p className="text-subtle-copy mt-2 text-xs">
        Internal-only adapters are hidden to keep this view operationally useful.
      </p>
    </div>
  )
}

function NetworkInterfaceCard({
  iface,
}: {
  iface: { name: string; address: string; mac: string; netmask: string }
}) {
  return (
    <div className="border-line-soft bg-panel-soft hover:bg-panel-selected rounded-2xl border p-4 transition-colors">
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
          { label: 'Netmask', value: iface.netmask, span: 'sm:col-span-2' },
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
  )
}
