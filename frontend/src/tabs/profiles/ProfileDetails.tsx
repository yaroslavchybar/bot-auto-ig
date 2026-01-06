import type { Profile } from './types'
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

interface ProfileDetailsProps {
    profile: Profile
}

export function ProfileDetails({
    profile,
}: ProfileDetailsProps) {
    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        {profile.name}
                        {profile.login && (
                            <Badge variant="secondary" className="text-xs font-normal">Logged In</Badge>
                        )}
                    </h2>
                    <div className="flex items-center gap-2 mt-2">
                        <Badge variant={profile.using ? "default" : "secondary"} className={profile.using ? "bg-green-600 hover:bg-green-700" : ""}>
                            {profile.status ?? 'idle'}
                        </Badge>
                        {profile.type && <Badge variant="outline">{profile.type}</Badge>}
                    </div>
                </div>
            </div>

            <Separator />

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-lg">Configuration</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-3">
                        <div className="grid grid-cols-3 gap-1">
                            <span className="text-sm font-medium text-muted-foreground">Proxy</span>
                            <span className="text-sm col-span-2 break-all font-mono bg-muted p-1 rounded text-xs">{profile.proxy || '-'}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                            <span className="text-sm font-medium text-muted-foreground">Proxy Type</span>
                            <span className="text-sm col-span-2">{profile.proxy_type || '-'}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                            <span className="text-sm font-medium text-muted-foreground">Test IP</span>
                            <span className="text-sm col-span-2">{profile.test_ip ? 'Yes' : 'No'}</span>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-lg">Fingerprint</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-3">
                        <div className="grid grid-cols-3 gap-1">
                            <span className="text-sm font-medium text-muted-foreground">OS</span>
                            <span className="text-sm col-span-2">{profile.ua_os || '-'}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                            <span className="text-sm font-medium text-muted-foreground">Browser</span>
                            <span className="text-sm col-span-2">{profile.ua_browser || '-'}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                            <span className="text-sm font-medium text-muted-foreground">User Agent</span>
                            <span className="text-sm col-span-2 break-all font-mono bg-muted p-1 rounded text-xs max-h-[60px] overflow-y-auto custom-scrollbar">{profile.user_agent || '-'}</span>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
