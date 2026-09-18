
import { WebSocket } from 'ws'
import type { ChildProcess } from './ProcessService.js'

// Store connected WebSocket clients
export const clients: Set<WebSocket> = new Set()

// Store logs in memory (limited to last 1000 entries)
export const MAX_LOGS = 1000
export const logsStore: Array<{
    id: string;
    message: string;
    level: string;
    source: string;
    ts: number;
    profileName?: string;
    automationId?: string;
    taskId?: string;
    targetUsername?: string;
    errorCode?: string;
    outcome?: string;
    attempt?: number;
    diagnostics?: string;
}> = []

export const automationWorkers = new Map<
    string,
    { process: ChildProcess; status: 'running' | 'stopping'; startedAt: number }
>()

export type ActiveDisplaySession = {
    automationId: string
    profileName: string
    vncPort: number
    displayNum: number
    status: 'active'
}

export const activeDisplays = new Map<string, ActiveDisplaySession>()

// Profile browser processes
export const profileProcesses = new Map<string, ChildProcess>()

// Automation-owned active profiles. Each automation can run one or more profiles.
export const automationProfileSessions = new Map<string, Set<string>>()

export function markAutomationProfileActive(automationId: string, profileName: string): void {
    const cleanAutomationId = String(automationId || '').trim()
    const cleanProfileName = String(profileName || '').trim()
    if (!cleanAutomationId || !cleanProfileName) return

    const existing = automationProfileSessions.get(cleanAutomationId)
    if (existing) {
        existing.add(cleanProfileName)
        return
    }

    automationProfileSessions.set(cleanAutomationId, new Set([cleanProfileName]))
}

export function clearAutomationProfileActive(automationId: string, profileName?: string): void {
    const cleanAutomationId = String(automationId || '').trim()
    if (!cleanAutomationId) return

    if (typeof profileName === 'undefined') {
        automationProfileSessions.delete(cleanAutomationId)
        return
    }

    const cleanProfileName = String(profileName || '').trim()
    if (!cleanProfileName) return

    const existing = automationProfileSessions.get(cleanAutomationId)
    if (!existing) return

    existing.delete(cleanProfileName)
    if (existing.size === 0) {
        automationProfileSessions.delete(cleanAutomationId)
    }
}

export function getActiveRuntimeProfileNames(): string[] {
    const activeNames = new Set<string>()

    for (const name of profileProcesses.keys()) {
        const cleanName = String(name || '').trim()
        if (cleanName) activeNames.add(cleanName)
    }

    for (const profiles of automationProfileSessions.values()) {
        for (const name of profiles) {
            const cleanName = String(name || '').trim()
            if (cleanName) activeNames.add(cleanName)
        }
    }

    return Array.from(activeNames)
}
