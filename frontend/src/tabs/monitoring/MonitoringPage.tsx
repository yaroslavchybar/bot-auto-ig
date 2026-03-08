import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { apiFetch } from '@/lib/api'
import { env } from '@/lib/env'
import { usePerformanceMode } from '@/hooks/use-performance-mode'
import { useDocumentVisibility } from '@/hooks/use-document-visibility'
import { AmbientGlow } from '@/components/ui/ambient-glow'
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

const POLL_INTERVAL = 5000
const MOBILE_POLL_INTERVAL = 20000

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
    if (percent >= 60) return 'text-orange-400'
    return 'text-green-400'
}

function getProgressColor(percent: number): string {
    if (percent >= 80) return '[&>div]:bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.4)]'
    if (percent >= 60) return '[&>div]:bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.4)]'
    return '[&>div]:bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.4)]'
}

function getStatusBadge(percent: number) {
    if (percent >= 80) return <Badge className="text-xs bg-red-500/10 text-red-400 border-red-500/20 shadow-[0_0_10px_rgba(239,68,68,0.2)] hover:bg-red-500/20">Critical</Badge>
    if (percent >= 60) return <Badge className="text-xs bg-orange-500/10 text-orange-400 border-orange-500/20 hover:bg-orange-500/20">Warning</Badge>
    return <Badge className="text-xs bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20 shadow-[0_0_10px_rgba(34,197,94,0.2)]">Healthy</Badge>
}

// ─── Gauge Card ─────────────────────────────────────────────

function GaugeCard({
    title, icon: Icon, percent, used, total, free
}: {
    title: string; icon: React.ElementType; percent: number
    used: string; total: string; free: string
}) {
    return (
        <Card className="relative overflow-hidden bg-white/[0.02] border-white/5 backdrop-blur-sm rounded-2xl">
            <div className={`absolute top-0 left-0 w-1 h-full ${percent >= 80 ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]' : percent >= 60 ? 'bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.8)]' : 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.8)]'}`} />
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-gray-200">
                    <Icon className="h-4 w-4 text-gray-500" />
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
                <div className="grid grid-cols-3 gap-2 text-xs text-gray-500">
                    <div>
                        <div className="font-medium text-gray-200">{used}</div>
                        <div>Used</div>
                    </div>
                    <div>
                        <div className="font-medium text-gray-200">{free}</div>
                        <div>Free</div>
                    </div>
                    <div>
                        <div className="font-medium text-gray-200">{total}</div>
                        <div>Total</div>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

// ─── Main Page ──────────────────────────────────────────────

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
        return (
            <div className="flex-1 space-y-4 p-6 pt-4 overflow-auto h-full relative bg-[#050505] text-gray-200">
                <AmbientGlow />
                <div className="flex items-center justify-between relative z-10 border-b border-white/5 pb-4">
                    <h2 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">VPS Monitor</h2>
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 relative z-10">
                    {[1, 2, 3].map(i => (
                        <Card key={i} className="bg-white/[0.02] border border-white/5 backdrop-blur-sm rounded-2xl">
                            <CardHeader><Skeleton className="h-4 w-24 bg-white/10" /></CardHeader>
                            <CardContent className="space-y-3">
                                <Skeleton className="h-8 w-16 bg-white/10" />
                                <Skeleton className="h-2 w-full bg-white/10" />
                                <div className="grid grid-cols-3 gap-2">
                                    <Skeleton className="h-8 w-full bg-white/10" />
                                    <Skeleton className="h-8 w-full bg-white/10" />
                                    <Skeleton className="h-8 w-full bg-white/10" />
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
            <div className="flex-1 flex items-center justify-center p-6 relative bg-[#050505]">
                <AmbientGlow />
                <Card className="max-w-md w-full bg-[#0a0a0a] border border-white/10 relative z-10 rounded-2xl">
                    <CardContent className="pt-6 text-center space-y-4">
                        <div className="text-red-400 text-lg font-medium">Connection Error</div>
                        <p className="text-gray-400 text-sm">{error}</p>
                        <button
                            onClick={fetchData}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-gradient-to-r from-red-600 to-orange-500 text-white text-sm hover:shadow-[0_0_25px_rgba(239,68,68,0.6)] shadow-[0_0_15px_rgba(239,68,68,0.4)] border-none transition-all"
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
        <div className="flex-1 space-y-4 p-6 pt-4 overflow-auto h-full relative bg-[#050505] text-gray-200">
            <AmbientGlow />

            {/* Header */}
            <div className="flex items-center justify-between relative z-10 border-b border-white/5 pb-4">
                <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">VPS Monitor</h2>
                    {error && (
                        <Badge className="text-xs bg-red-500/10 text-red-400 border-red-500/20">Connection lost — using cached data</Badge>
                    )}
                </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                        <div className="flex items-center gap-1.5">
                            <span className="relative flex h-2 w-2">
                            <span className="mobile-effect-animate animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                        </span>
                        Live
                    </div>
                    {lastUpdate && (
                        <span className="text-gray-400">Updated {lastUpdate.toLocaleTimeString()}</span>
                    )}
                </div>
            </div>

            {/* Gauge Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 relative z-10">
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
            <div className="grid gap-4 md:grid-cols-2 relative z-10">
                {/* System Information */}
                <Card className="bg-white/[0.02] border-white/5 backdrop-blur-sm rounded-2xl">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-gray-200">
                            <Server className="h-4 w-4 text-gray-500" />
                            System Information
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            <div className="flex justify-between items-center py-1.5 border-b border-white/[0.05]">
                                <span className="text-sm text-gray-400">Hostname</span>
                                <span className="text-sm font-mono text-gray-200">{data.system.hostname}</span>
                            </div>
                            <div className="flex justify-between items-center py-1.5 border-b border-white/[0.05]">
                                <span className="text-sm text-gray-400">Platform</span>
                                <span className="text-sm font-mono text-gray-200">{data.system.platform}</span>
                            </div>
                            <div className="flex justify-between items-center py-1.5 border-b border-white/[0.05]">
                                <span className="text-sm text-gray-400">Architecture</span>
                                <span className="text-sm font-mono text-gray-200">{data.system.arch}</span>
                            </div>
                            <div className="flex justify-between items-center py-1.5 border-b border-white/[0.05]">
                                <span className="text-sm text-gray-400">Kernel</span>
                                <span className="text-sm font-mono truncate ml-4 max-w-[200px] text-gray-200">{data.system.release}</span>
                            </div>
                            <div className="flex justify-between items-center py-1.5 border-b border-white/[0.05]">
                                <span className="text-sm text-gray-400">CPU Model</span>
                                <span className="text-sm font-mono truncate ml-4 max-w-[200px] text-gray-200" title={data.cpu.model}>{data.cpu.model}</span>
                            </div>
                            <div className="flex justify-between items-center py-1.5">
                                <span className="text-sm text-gray-400 flex items-center gap-1.5">
                                    <Clock className="h-3.5 w-3.5 text-gray-500" /> Uptime
                                </span>
                                <span className="text-sm font-mono text-green-400">{data.system.uptimeFormatted}</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Network */}
                <Card className="bg-white/[0.02] border-white/5 backdrop-blur-sm rounded-2xl">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-gray-200">
                            <Wifi className="h-4 w-4 text-gray-500" />
                            Network Interfaces
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {externalInterfaces.length === 0 ? (
                            <div className="text-sm text-gray-500 py-4 text-center">
                                No external network interfaces found
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {externalInterfaces.map((iface, i) => (
                                    <div key={i} className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04] transition-colors space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-medium flex items-center gap-2 text-gray-200">
                                                <Activity className="h-3.5 w-3.5 text-green-400" />
                                                {iface.name}
                                            </span>
                                            <Badge className="text-xs bg-transparent border border-white/10 text-gray-300">IPv4</Badge>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                            <div>
                                                <span className="text-gray-500">IP: </span>
                                                <span className="font-mono text-gray-200">{iface.address}</span>
                                            </div>
                                            <div>
                                                <span className="text-gray-500">MAC: </span>
                                                <span className="font-mono text-gray-200">{iface.mac}</span>
                                            </div>
                                            <div className="col-span-2">
                                                <span className="text-gray-500">Netmask: </span>
                                                <span className="font-mono text-gray-200">{iface.netmask}</span>
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
