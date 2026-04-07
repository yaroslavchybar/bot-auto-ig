
import { WebSocket } from 'ws'
import type { ChildProcess } from './ProcessService.js'

// Store connected WebSocket clients
export const clients: Set<WebSocket> = new Set()

// Store logs in memory (limited to last 1000 entries)
export const MAX_LOGS = 1000
export const logsStore: Array<{
    message: string;
    level: string;
    source: string;
    ts: number;
    profileName?: string;
    workflowId?: string;
    taskId?: string;
    targetUsername?: string;
    errorCode?: string;
    outcome?: string;
    attempt?: number;
    diagnostics?: string;
}> = []

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

// Workflow-owned active profiles. Each workflow can run one or more profiles.
export const workflowProfileSessions = new Map<string, Set<string>>()

export function markWorkflowProfileActive(workflowId: string, profileName: string): void {
    const cleanWorkflowId = String(workflowId || '').trim()
    const cleanProfileName = String(profileName || '').trim()
    if (!cleanWorkflowId || !cleanProfileName) return

    const existing = workflowProfileSessions.get(cleanWorkflowId)
    if (existing) {
        existing.add(cleanProfileName)
        return
    }

    workflowProfileSessions.set(cleanWorkflowId, new Set([cleanProfileName]))
}

export function clearWorkflowProfileActive(workflowId: string, profileName?: string): void {
    const cleanWorkflowId = String(workflowId || '').trim()
    if (!cleanWorkflowId) return

    if (typeof profileName === 'undefined') {
        workflowProfileSessions.delete(cleanWorkflowId)
        return
    }

    const cleanProfileName = String(profileName || '').trim()
    if (!cleanProfileName) return

    const existing = workflowProfileSessions.get(cleanWorkflowId)
    if (!existing) return

    existing.delete(cleanProfileName)
    if (existing.size === 0) {
        workflowProfileSessions.delete(cleanWorkflowId)
    }
}

export function getActiveRuntimeProfileNames(): string[] {
    const activeNames = new Set<string>()

    for (const name of profileProcesses.keys()) {
        const cleanName = String(name || '').trim()
        if (cleanName) activeNames.add(cleanName)
    }

    for (const profiles of workflowProfileSessions.values()) {
        for (const name of profiles) {
            const cleanName = String(name || '').trim()
            if (cleanName) activeNames.add(cleanName)
        }
    }

    return Array.from(activeNames)
}
