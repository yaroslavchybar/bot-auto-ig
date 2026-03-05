import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { apiFetch } from '@/lib/api'
import {
    Cpu,
    MemoryStick,
    HardDrive,
    Clock,
    Server,
    Activity,
    RefreshCw,
    Wifi,
} from 'lucide-react'

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const POLL_INTERVAL = 5000

interface MonitoringData {
    cpu: { percent: number; cores: number; model: string }
    memory: {
        total: number; used: number; free: number; percent: number
        totalFormatted: string; usedFormatted: string; freeFormatted: string
    }
    disk: {
        total: number; used: number; free: number; percent: number
        totalFormatted: string; usedFormatted: string; freeFormatted: string
    }
    system: {
        hostname: string; platform: string; arch: string; release: string
        uptime: number; uptimeFormatted: string
    }
    network: Record<string, Array<{
        address: string; netmask: string; family: string
        mac: string; internal: boolean
    }>>
    timestamp: string
}

function getStatusColor(percent: number): string {
    if (percent >= 80) return 'text-red-400'
    if (percent >= 60) return 'text-yellow-400'
    return 'text-emerald-400'
}

function getProgressColor(percent: number): string {
    if (percent >= 80) return '[&>div]:bg-red-500'
    if (percent >= 60) return '[&>div]:bg-yellow-500'
    return '[&>div]:bg-emerald-500'
}

function getStatusBadge(percent: number) {
    if (percent >= 80) return <Badge variant="destructive" className="text-xs">Critical</Badge>
    if (percent >= 60) return <Badge className="text-xs bg-yellow-500/20 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/20">Warning</Badge>
    return <Badge className="text-xs bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20">Healthy</Badge>
}

// ─── Gauge Card ─────────────────────────────────────────────

function GaugeCard({
    title, icon: Icon, percent, used, total, free
}: {
    title: string; icon: React.ElementType; percent: number
    used: string; total: string; free: string
}) {
    return (
        <Card className="relative overflow-hidden">
            <div className={`absolute top-0 left-0 w-1 h-full ${percent >= 80 ? 'bg-red-500' : percent >= 60 ? 'bg-yellow-500' : 'bg-emerald-500'}`} />
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {title}
                </CardTitle>
                {getStatusBadge(percent)}
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="flex items-end gap-2">
                    <span className={`text-3xl font-bold tabular-nums ${getStatusColor(percent)}`}>
                        {percent}%
                    </span>
                </div>
                <Progress value={percent} className={`h-2 ${getProgressColor(percent)}`} />
                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <div>
                        <div className="font-medium text-foreground">{used}</div>
                        <div>Used</div>
                    </div>
                    <div>
                        <div className="font-medium text-foreground">{free}</div>
                        <div>Free</div>
                    </div>
                    <div>
                        <div className="font-medium text-foreground">{total}</div>
                        <div>Total</div>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

// ─── Main Page ──────────────────────────────────────────────

export function MonitoringPage() {
    const [data, setData] = useState<MonitoringData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

    const fetchData = useCallback(async () => {
        try {
            const endpoint = API_BASE ? `${API_BASE}/api/monitoring` : '/api/monitoring'
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
        fetchData()
        const interval = setInterval(fetchData, POLL_INTERVAL)
        return () => clearInterval(interval)
    }, [fetchData])

    if (loading) {
        return (
            <div className="flex-1 space-y-4 p-6 pt-4 overflow-auto h-full">
                <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold tracking-tight">VPS Monitor</h2>
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {[1, 2, 3].map(i => (
                        <Card key={i}>
                            <CardHeader><Skeleton className="h-4 w-24" /></CardHeader>
                            <CardContent className="space-y-3">
                                <Skeleton className="h-8 w-16" />
                                <Skeleton className="h-2 w-full" />
                                <div className="grid grid-cols-3 gap-2">
                                    <Skeleton className="h-8 w-full" />
                                    <Skeleton className="h-8 w-full" />
                                    <Skeleton className="h-8 w-full" />
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>
        )
    }

    if (error && !data) {
        return (
            <div className="flex-1 flex items-center justify-center p-6">
                <Card className="max-w-md w-full">
                    <CardContent className="pt-6 text-center space-y-4">
                        <div className="text-red-400 text-lg font-medium">Connection Error</div>
                        <p className="text-muted-foreground text-sm">{error}</p>
                        <button
                            onClick={fetchData}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors"
                        >
                            <RefreshCw className="h-4 w-4" /> Retry
                        </button>
                    </CardContent>
                </Card>
            </div>
        )
    }

    if (!data) return null

    // Get non-internal network interfaces
    const externalInterfaces = Object.entries(data.network)
        .flatMap(([name, addrs]) =>
            addrs.filter(a => !a.internal && a.family === 'IPv4').map(a => ({ name, ...a }))
        )

    return (
        <div className="flex-1 space-y-4 p-6 pt-4 overflow-auto h-full">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-bold tracking-tight">VPS Monitor</h2>
                    {error && (
                        <Badge variant="destructive" className="text-xs">Connection lost — using cached data</Badge>
                    )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        Live
                    </div>
                    {lastUpdate && (
                        <span>Updated {lastUpdate.toLocaleTimeString()}</span>
                    )}
                </div>
            </div>

            {/* Gauge Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <GaugeCard
                    title="CPU Usage"
                    icon={Cpu}
                    percent={data.cpu.percent}
                    used={`${data.cpu.percent}%`}
                    total={`${data.cpu.cores} cores`}
                    free={`${100 - data.cpu.percent}%`}
                />
                <GaugeCard
                    title="Memory (RAM)"
                    icon={MemoryStick}
                    percent={data.memory.percent}
                    used={data.memory.usedFormatted}
                    total={data.memory.totalFormatted}
                    free={data.memory.freeFormatted}
                />
                <GaugeCard
                    title="Disk Usage"
                    icon={HardDrive}
                    percent={data.disk.percent}
                    used={data.disk.usedFormatted}
                    total={data.disk.totalFormatted}
                    free={data.disk.freeFormatted}
                />
            </div>

            {/* System Info & Network */}
            <div className="grid gap-4 md:grid-cols-2">
                {/* System Information */}
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <Server className="h-4 w-4 text-muted-foreground" />
                            System Information
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            <div className="flex justify-between items-center py-1.5 border-b border-border/50">
                                <span className="text-sm text-muted-foreground">Hostname</span>
                                <span className="text-sm font-mono">{data.system.hostname}</span>
                            </div>
                            <div className="flex justify-between items-center py-1.5 border-b border-border/50">
                                <span className="text-sm text-muted-foreground">Platform</span>
                                <span className="text-sm font-mono">{data.system.platform}</span>
                            </div>
                            <div className="flex justify-between items-center py-1.5 border-b border-border/50">
                                <span className="text-sm text-muted-foreground">Architecture</span>
                                <span className="text-sm font-mono">{data.system.arch}</span>
                            </div>
                            <div className="flex justify-between items-center py-1.5 border-b border-border/50">
                                <span className="text-sm text-muted-foreground">Kernel</span>
                                <span className="text-sm font-mono truncate ml-4 max-w-[200px]">{data.system.release}</span>
                            </div>
                            <div className="flex justify-between items-center py-1.5 border-b border-border/50">
                                <span className="text-sm text-muted-foreground">CPU Model</span>
                                <span className="text-sm font-mono truncate ml-4 max-w-[200px]" title={data.cpu.model}>{data.cpu.model}</span>
                            </div>
                            <div className="flex justify-between items-center py-1.5">
                                <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                                    <Clock className="h-3.5 w-3.5" /> Uptime
                                </span>
                                <span className="text-sm font-mono text-emerald-400">{data.system.uptimeFormatted}</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Network */}
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <Wifi className="h-4 w-4 text-muted-foreground" />
                            Network Interfaces
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {externalInterfaces.length === 0 ? (
                            <div className="text-sm text-muted-foreground py-4 text-center">
                                No external network interfaces found
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {externalInterfaces.map((iface, i) => (
                                    <div key={i} className="p-3 rounded-lg bg-muted/30 border border-border/50 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-medium flex items-center gap-2">
                                                <Activity className="h-3.5 w-3.5 text-emerald-400" />
                                                {iface.name}
                                            </span>
                                            <Badge variant="outline" className="text-xs">IPv4</Badge>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                            <div>
                                                <span className="text-muted-foreground">IP: </span>
                                                <span className="font-mono">{iface.address}</span>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground">MAC: </span>
                                                <span className="font-mono">{iface.mac}</span>
                                            </div>
                                            <div className="col-span-2">
                                                <span className="text-muted-foreground">Netmask: </span>
                                                <span className="font-mono">{iface.netmask}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
