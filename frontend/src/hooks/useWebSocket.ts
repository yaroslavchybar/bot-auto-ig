import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'

export interface LogEntry {
    message: string
    level: string
    source: string
    workflowId?: string
    ts: number
}

export interface AutomationProgress {
    totalAccounts: number;
    currentProfile: string | null;
    currentTask: string | null;
}

interface WebSocketMessage {
    type: 'log' | 'status' | 'workflow_status' | 'error' | 'session_started' | 'profile_started' | 'task_started' | 'profile_completed' | 'session_ended';
    message?: string;
    level?: string;
    source?: string;
    status?: string;
    workflowId?: string;
    workflow_id?: string;
    // Event payloads
    total_accounts?: number;
    profile?: string;
    task?: string;
}

interface UseWebSocketOptions {
    url?: string
    autoConnect?: boolean
    workflowId?: string | null
}

// Reconnection backoff constants
const BASE_RECONNECT_DELAY = 1000
const MAX_RECONNECT_DELAY = 30000

function getDefaultWebSocketUrl() {
    if (typeof window === 'undefined') return 'ws://localhost:3001/ws'
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws`
}

function getReconnectDelay(attempt: number): number {
    const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, attempt), MAX_RECONNECT_DELAY)
    const jitter = delay * 0.2 * Math.random()
    return delay + jitter
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
    const { url, autoConnect = true, workflowId } = options
    const wsUrl = url ?? getDefaultWebSocketUrl()
    const { getToken } = useAuth()

    const [logs, setLogs] = useState<LogEntry[]>([])
    const [status, setStatus] = useState<'idle' | 'running' | 'stopping'>('idle')
    const [progress, setProgress] = useState<AutomationProgress>({
        totalAccounts: 0,
        currentProfile: null,
        currentTask: null,
    })
    const [connected, setConnected] = useState(false)
    const [reconnectCounter, setReconnectCounter] = useState(0)
    const wsRef = useRef<WebSocket | null>(null)
    const workflowIdRef = useRef<string | null>(workflowId ?? null)
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const reconnectAttemptRef = useRef(0)

    useEffect(() => {
        workflowIdRef.current = workflowId ?? null
    }, [workflowId])

    const clearLogs = useCallback(() => {
        setLogs([])
    }, [])

    const disconnect = useCallback(() => {
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current)
            reconnectTimeoutRef.current = null
        }
        wsRef.current?.close()
        wsRef.current = null
        setConnected(false)
    }, [])

    // Connect effect - triggered by reconnectCounter for auto-reconnect
    useEffect(() => {
        if (!autoConnect && reconnectCounter === 0) return
        if (wsRef.current?.readyState === WebSocket.OPEN) return

        let cancelled = false

            // Async IIFE to fetch token before connecting
            ; (async () => {
                let tokenParam = ''
                try {
                    const token = await getToken()
                    if (token) {
                        tokenParam = `?token=${encodeURIComponent(token)}`
                    }
                } catch {
                    // Continue without token - server will reject if required
                }

                if (cancelled) return

                try {
                    const ws = new WebSocket(`${wsUrl}${tokenParam}`)

                    ws.onopen = () => {
                        if (cancelled) {
                            ws.close()
                            return
                        }
                        reconnectAttemptRef.current = 0 // Reset on successful connect
                        setConnected(true)
                    }

                    ws.onmessage = (event) => {
                        if (cancelled) return
                        try {
                            const data: WebSocketMessage = JSON.parse(event.data)
                            const msgWorkflowId = data.workflowId ?? data.workflow_id ?? null
                            const activeWorkflowId = workflowIdRef.current
                            const matchesWorkflow =
                                !activeWorkflowId ? true : msgWorkflowId === activeWorkflowId

                            if (data.type === 'log' && data.message) {
                                if (!matchesWorkflow) return
                                if (activeWorkflowId && !msgWorkflowId) return
                                const entry: LogEntry = {
                                    message: data.message,
                                    level: data.level || 'info',
                                    source: data.source || 'unknown',
                                    workflowId: msgWorkflowId ?? undefined,
                                    ts: Date.now(),
                                }
                                setLogs((prev) => [...prev.slice(-499), entry])
                            } else if (data.type === 'status' && data.status) {
                                if (activeWorkflowId) return
                                if (msgWorkflowId) return
                                setStatus(data.status as 'idle' | 'running' | 'stopping')
                            } else if (data.type === 'workflow_status' && data.status) {
                                if (!matchesWorkflow) return
                                if (activeWorkflowId && !msgWorkflowId) return
                                setStatus(data.status as 'idle' | 'running' | 'stopping')
                            } else if (data.type === 'session_started') {
                                if (!matchesWorkflow) return
                                if (activeWorkflowId && !msgWorkflowId) return
                                setProgress({
                                    totalAccounts: data.total_accounts || 0,
                                    currentProfile: null,
                                    currentTask: null,
                                });
                            } else if (data.type === 'profile_started') {
                                if (!matchesWorkflow) return
                                if (activeWorkflowId && !msgWorkflowId) return
                                setProgress(prev => ({ ...prev, currentProfile: data.profile || null, currentTask: null }));
                            } else if (data.type === 'task_started') {
                                if (!matchesWorkflow) return
                                if (activeWorkflowId && !msgWorkflowId) return
                                setProgress(prev => ({ ...prev, currentTask: data.task || null }));
                            } else if (data.type === 'profile_completed') {
                                if (!matchesWorkflow) return
                                if (activeWorkflowId && !msgWorkflowId) return
                                setProgress(prev => ({ ...prev, currentProfile: null, currentTask: null }));
                            }
                        } catch {
                            // ignore parse errors
                        }
                    }

                    ws.onclose = () => {
                        if (cancelled) return
                        setConnected(false)
                        wsRef.current = null

                        // Auto-reconnect with exponential backoff
                        if (autoConnect) {
                            const delay = getReconnectDelay(reconnectAttemptRef.current++)
                            reconnectTimeoutRef.current = setTimeout(() => {
                                if (!cancelled) {
                                    setReconnectCounter((c) => c + 1)
                                }
                            }, delay)
                        }
                    }

                    ws.onerror = () => {
                        ws.close()
                    }

                    wsRef.current = ws
                } catch {
                    // connection failed, schedule retry with exponential backoff
                    if (autoConnect && !cancelled) {
                        const delay = getReconnectDelay(reconnectAttemptRef.current++)
                        reconnectTimeoutRef.current = setTimeout(() => {
                            if (!cancelled) {
                                setReconnectCounter((c) => c + 1)
                            }
                        }, delay)
                    }
                }
            })()

        return () => {
            cancelled = true
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current)
                reconnectTimeoutRef.current = null
            }
            wsRef.current?.close()
            wsRef.current = null
        }
    }, [wsUrl, autoConnect, reconnectCounter, getToken])

    const connect = useCallback(() => {
        setReconnectCounter((c) => c + 1)
    }, [])

    return {
        logs,
        status,
        progress,
        connected,
        clearLogs,
        connect,
        disconnect,
    }
}
