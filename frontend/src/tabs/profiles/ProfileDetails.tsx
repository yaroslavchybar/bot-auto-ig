import type { Profile } from './types'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Fingerprint,
  Globe,
  Monitor,
  Shield,
  Box,
  Activity,
  CalendarClock,
} from 'lucide-react'

interface ProfileDetailsProps {
  profile: Profile
}

export function ProfileDetails({ profile }: ProfileDetailsProps) {
  return (
    <div className="flex flex-col">
      {/* Header Section */}
      <div className="p-6 pb-2">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-ink text-2xl font-semibold tracking-tight">
              {profile.name}
            </h3>
            <p className="text-subtle-copy mt-1 font-mono text-sm opacity-50 select-all">
              {profile.id}
            </p>
          </div>
          <Badge
            variant={profile.using ? 'default' : 'secondary'}
            className={
              profile.using
                ? 'status-glow-success bg-status-success-soft text-status-success border-status-success-border hover:bg-status-success-strong border'
                : 'bg-panel-muted text-copy border-line hover:bg-panel-hover'
            }
          >
            {profile.using ? 'Active' : 'Idle'}
          </Badge>
        </div>
      </div>

      <div className="px-6 py-4">
        <div className="grid gap-4">
          <DetailRow
            icon={<Activity className="h-4 w-4" />}
            label="Status"
            value={profile.status || 'Ready'}
          />
          <DetailRow
            icon={<CalendarClock className="h-4 w-4" />}
            label="Created / Updated"
            value="Just now" // Placeholder or actual date if available
          />
        </div>
      </div>

      <Separator className="bg-panel-muted" />

      {/* Application Data */}
      <div className="p-6">
        <h4 className="text-copy mb-4 flex items-center gap-2 text-sm font-medium">
          <Globe className="h-4 w-4" /> Network & Proxy
        </h4>
        <div className="border-line-soft ml-1.5 grid gap-4 border-l pl-2">
          <DetailRow
            label="Proxy Host"
            value={profile.proxy || 'Direct Connection'}
            mono={!!profile.proxy}
            className={!profile.proxy ? 'text-subtle-copy/50' : 'text-ink'}
          />
          <DetailRow
            label="Protocol"
            value={profile.proxy_type || 'HTTP'}
            className="text-ink"
          />
          <DetailRow
            label="IP Check"
            value={profile.test_ip ? 'Enabled' : 'Disabled'}
            className="text-ink"
          />
        </div>
      </div>

      <Separator className="bg-panel-muted" />

      {/* Fingerprint Data */}
      <div className="p-6">
        <h4 className="text-copy mb-4 flex items-center gap-2 text-sm font-medium">
          <Fingerprint className="h-4 w-4" /> Digital Fingerprint
        </h4>
        {profile.fingerprint_seed ? (
          <div className="border-line-soft ml-1.5 grid gap-4 border-l pl-2">
            <DetailRow
              icon={<Monitor className="h-3.5 w-3.5" />}
              label="Operating System"
              value={profile.fingerprint_os === 'mac' ? 'macOS' : 'Windows'}
              className="text-ink"
            />
            <div className="space-y-1.5">
              <span className="text-muted-copy flex items-center gap-1.5 text-xs font-medium">
                <Shield className="h-3.5 w-3.5" /> Seed
              </span>
              <div className="bg-panel-muted border-line-soft text-muted-copy rounded-md border p-2 font-mono text-xs break-all">
                {profile.fingerprint_seed}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-subtle-copy border-line border-l-2 pl-4 text-sm">
            No custom fingerprint configured.
          </div>
        )}
      </div>

      <Separator className="bg-panel-muted" />

      <div className="bg-panel-subtle p-6">
        <h4 className="text-copy mb-2 flex items-center gap-2 text-sm font-medium">
          <Box className="h-4 w-4" /> Metadata
        </h4>
        <p className="text-subtle-copy text-xs leading-relaxed">
          This profile can be used for manual browser sessions and, when it has
          a proxy and session, contribute scraping capacity. Be careful when
          modifying fingerprint settings as it may trigger re-authentication
          verification on target platforms.
        </p>
      </div>
    </div>
  )
}

function DetailRow({
  icon,
  label,
  value,
  mono = false,
  className,
}: {
  icon?: React.ReactNode
  label: string
  value: string
  mono?: boolean
  className?: string
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-center gap-2">
      <span className="text-muted-copy flex items-center gap-1.5 text-xs font-medium">
        {icon} {label}
      </span>
      <span
        className={`text-sm ${mono ? 'font-mono' : ''} ${className || 'text-ink'} truncate`}
      >
        {value}
      </span>
    </div>
  )
}
