
import { WebSocket } from 'ws'
import { ChildProcess } from 'child_process'

// Store connected WebSocket clients
export const clients: Set<WebSocket> = new Set()

// Store logs in memory (limited to last 1000 entries)
export const MAX_LOGS = 1000
export const logsStore: Array<{ message: string; level: string; source: string; ts: number; profileName?: string; workflowId?: string }> = []

// Automation state
export const automationState = {
    process: null as ChildProcess | null,
    status: 'idle' as 'idle' | 'running' | 'stopping'
}

export const workflowWorkers = new Map<
    string,
    { process: ChildProcess; status: 'running' | 'stopping'; startedAt: number }
>()

export type ActiveDisplaySession = {
    workflowId: string
    profileName: string
    vncPort: number
    displayNum: number
    status: 'active'
}

export const activeDisplays = new Map<string, ActiveDisplaySession>()

// Profile browser processes
export const profileProcesses = new Map<string, ChildProcess>()
