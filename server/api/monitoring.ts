/**
 * VPS Monitoring API
 * Returns system metrics: CPU, RAM, Disk, Network, Uptime
 * Uses Node.js built-in modules — no external dependencies needed.
 */
import { Router } from 'express'
import os from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const router = Router()

// ─── Helpers ────────────────────────────────────────────────

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400)
    const h = Math.floor((seconds % 86400) / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    const parts: string[] = []
    if (d > 0) parts.push(`${d}d`)
    if (h > 0) parts.push(`${h}h`)
    if (m > 0) parts.push(`${m}m`)
    parts.push(`${s}s`)
    return parts.join(' ')
}

// Store the previous CPU snapshot so we can compute deltas
let prevCpuSnapshot: { idle: number; total: number } | null = null

function getCpuUsage(): number {
    const cpus = os.cpus()
    let idle = 0
    let total = 0

    for (const cpu of cpus) {
        idle += cpu.times.idle
        total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq
    }

    if (prevCpuSnapshot) {
        const idleDelta = idle - prevCpuSnapshot.idle
        const totalDelta = total - prevCpuSnapshot.total
        prevCpuSnapshot = { idle, total }
        if (totalDelta === 0) return 0
        return Math.round((1 - idleDelta / totalDelta) * 100)
    }

    prevCpuSnapshot = { idle, total }
    // First call: rough estimate based on current snapshot
    if (total === 0) return 0
    return Math.round((1 - idle / total) * 100)
}

async function getDiskUsage(): Promise<{ total: number; used: number; free: number; percent: number }> {
    try {
        if (process.platform === 'win32') {
            const { stdout } = await execAsync(
                'wmic logicaldisk where "DeviceID=\'C:\'" get Size,FreeSpace /format:csv',
                { timeout: 5000 }
            )
            const lines = stdout.trim().split('\n').filter(l => l.trim())
            const lastLine = lines[lines.length - 1]
            const parts = lastLine.split(',')
            const free = parseInt(parts[1]) || 0
            const total = parseInt(parts[2]) || 0
            const used = total - free
            return { total, used, free, percent: total > 0 ? Math.round((used / total) * 100) : 0 }
        } else {
            // Linux / macOS
            const { stdout } = await execAsync("df -B1 / | tail -1 | awk '{print $2, $3, $4}'", { timeout: 5000 })
            const [totalStr, usedStr, freeStr] = stdout.trim().split(/\s+/)
            const total = parseInt(totalStr) || 0
            const used = parseInt(usedStr) || 0
            const free = parseInt(freeStr) || 0
            return { total, used, free, percent: total > 0 ? Math.round((used / total) * 100) : 0 }
        }
    } catch {
        return { total: 0, used: 0, free: 0, percent: 0 }
    }
}

// ─── Route ──────────────────────────────────────────────────

router.get('/', async (_req, res) => {
    try {
        const cpuPercent = getCpuUsage()
        const disk = await getDiskUsage()

        const totalMem = os.totalmem()
        const freeMem = os.freemem()
        const usedMem = totalMem - freeMem
        const memPercent = Math.round((usedMem / totalMem) * 100)

        const cpuInfo = os.cpus()
        const uptime = os.uptime()

        res.json({
            cpu: {
                percent: cpuPercent,
                cores: cpuInfo.length,
                model: cpuInfo[0]?.model || 'Unknown',
            },
            memory: {
                total: totalMem,
                used: usedMem,
                free: freeMem,
                percent: memPercent,
                totalFormatted: formatBytes(totalMem),
                usedFormatted: formatBytes(usedMem),
                freeFormatted: formatBytes(freeMem),
            },
            disk: {
                total: disk.total,
                used: disk.used,
                free: disk.free,
                percent: disk.percent,
                totalFormatted: formatBytes(disk.total),
                usedFormatted: formatBytes(disk.used),
                freeFormatted: formatBytes(disk.free),
            },
            system: {
                hostname: os.hostname(),
                platform: os.platform(),
                arch: os.arch(),
                release: os.release(),
                uptime,
                uptimeFormatted: formatUptime(uptime),
            },
            network: os.networkInterfaces(),
            timestamp: new Date().toISOString(),
        })
    } catch (err) {
        console.error('[Monitoring] Error collecting metrics:', err)
        res.status(500).json({ error: 'Failed to collect system metrics' })
    }
})

export default router
