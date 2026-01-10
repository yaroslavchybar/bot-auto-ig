import type { Profile } from './types'
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Fingerprint, Globe, Monitor, Shield, Box, Activity, CalendarClock } from "lucide-react"

interface ProfileDetailsProps {
    profile: Profile
}

export function ProfileDetails({
    profile,
}: ProfileDetailsProps) {
    return (
        <div className="flex flex-col">
            {/* Header Section */}
            <div className="p-6 pb-2">
                <div className="flex items-start justify-between">
                    <div>
                        <h3 className="text-2xl font-semibold tracking-tight">{profile.name}</h3>
                        <p className="text-sm text-muted-foreground font-mono mt-1 opacity-50 select-all">{profile.id}</p>
                    </div>
                    <Badge variant={profile.using ? "default" : "secondary"} className={profile.using ? "bg-green-600 hover:bg-green-700" : ""}>
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

            <Separator />

            {/* Application Data */}
            <div className="p-6">
                <h4 className="text-sm font-medium mb-4 flex items-center gap-2 text-foreground/80">
                    <Globe className="h-4 w-4" /> Network & Proxy
                </h4>
                <div className="grid gap-4 pl-2 border-l border-border/50 ml-1.5">
                    <DetailRow
                        label="Proxy Host"
                        value={profile.proxy || 'Direct Connection'}
                        mono={!!profile.proxy}
                        className={!profile.proxy ? "text-muted-foreground/50" : ""}
                    />
                    <DetailRow
                        label="Protocol"
                        value={profile.proxy_type || 'HTTP'}
                    />
                    <DetailRow
                        label="IP Check"
                        value={profile.test_ip ? 'Enabled' : 'Disabled'}
                    />
                </div>
            </div>

            <Separator />

            {/* Fingerprint Data */}
            <div className="p-6">
                <h4 className="text-sm font-medium mb-4 flex items-center gap-2 text-foreground/80">
                    <Fingerprint className="h-4 w-4" /> Digital Fingerprint
                </h4>
                {profile.fingerprint_seed ? (
                    <div className="grid gap-4 pl-2 border-l border-border/50 ml-1.5">
                        <DetailRow
                            icon={<Monitor className="h-3.5 w-3.5" />}
                            label="Operating System"
                            value={profile.fingerprint_os === 'mac' ? 'macOS' : 'Windows'}
                        />
                        <div className="space-y-1.5">
                            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                                <Shield className="h-3.5 w-3.5" /> Seed
                            </span>
                            <div className="bg-muted/40 border rounded-md p-2 font-mono text-xs break-all text-muted-foreground/80">
                                {profile.fingerprint_seed}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="text-sm text-muted-foreground pl-4 border-l-2 border-muted">
                        No custom fingerprint configured.
                    </div>
                )}
            </div>

            <Separator />

            <div className="p-6 bg-muted/5">
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2 text-foreground/80">
                    <Box className="h-4 w-4" /> Metadata
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                    This profile is managed by the automation system. Be careful when modifying fingerprint settings as it may trigger re-authentication verification on target platforms.
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
    className
}: {
    icon?: React.ReactNode,
    label: string,
    value: string,
    mono?: boolean,
    className?: string
}) {
    return (
        <div className="grid grid-cols-[120px_1fr] items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                {icon} {label}
            </span>
            <span className={`text-sm ${mono ? 'font-mono' : ''} ${className} truncate`}>
                {value}
            </span>
        </div>
    )
}
