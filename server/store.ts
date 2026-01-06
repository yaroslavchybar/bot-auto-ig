
import { WebSocket } from 'ws'
import { ChildProcess } from 'child_process'

// Store connected WebSocket clients
export const clients: Set<WebSocket> = new Set()

// Store logs in memory (limited to last 500 entries)
export const MAX_LOGS = 500
export const logsStore: Array<{ message: string; level: string; source: string; ts: number }> = []

// Automation state
export const automationState = {
    process: null as ChildProcess | null,
    status: 'idle' as 'idle' | 'running' | 'stopping'
}

// Profile browser processes
export const profileProcesses = new Map<string, ChildProcess>()
