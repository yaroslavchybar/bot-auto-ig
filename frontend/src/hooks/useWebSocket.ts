import { useCallback, useEffect, useRef, useState } from 'react'

export interface LogEntry {
    message: string
    level: string
    source: string
    ts: number
}

export interface AutomationProgress {
    totalAccounts: number;
    currentProfile: string | null;
    currentTask: string | null;
}

interface WebSocketMessage {
    type: 'log' | 'status' | 'error' | 'session_started' | 'profile_started' | 'task_started' | 'profile_completed' | 'session_ended';
    message?: string;
    level?: string;
    source?: string;
    status?: string;
    // Event payloads
    total_accounts?: number;
    profile?: string;
    task?: string;
}

interface UseWebSocketOptions {
    url?: string
    autoConnect?: boolean
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
    const { url = 'ws://localhost:3001/ws', autoConnect = true } = options

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
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

        try {
            const ws = new WebSocket(url)

            ws.onopen = () => {
                if (cancelled) {
                    ws.close()
                    return
                }
                setConnected(true)
            }

            ws.onmessage = (event) => {
                if (cancelled) return
                try {
                    const data: WebSocketMessage = JSON.parse(event.data)

                    if (data.type === 'log' && data.message) {
                        const entry: LogEntry = {
                            message: data.message,
                            level: data.level || 'info',
                            source: data.source || 'unknown',
                            ts: Date.now(),
                        }
                        setLogs((prev) => [...prev.slice(-499), entry])
                    } else if (data.type === 'status' && data.status) {
                        setStatus(data.status as 'idle' | 'running' | 'stopping')
                    } else if (data.type === 'session_started') {
                        setProgress({
                            totalAccounts: data.total_accounts || 0,
                            currentProfile: null,
                            currentTask: null,
                        });
                    } else if (data.type === 'profile_started') {
                        setProgress(prev => ({ ...prev, currentProfile: data.profile || null, currentTask: null }));
                    } else if (data.type === 'task_started') {
                        setProgress(prev => ({ ...prev, currentTask: data.task || null }));
                    } else if (data.type === 'profile_completed') {
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

                // Auto-reconnect after 3 seconds
                if (autoConnect) {
                    reconnectTimeoutRef.current = setTimeout(() => {
                        if (!cancelled) {
                            setReconnectCounter((c) => c + 1)
                        }
                    }, 3000)
                }
            }

            ws.onerror = () => {
                ws.close()
            }

            wsRef.current = ws
        } catch {
            // connection failed, schedule retry
            if (autoConnect && !cancelled) {
                reconnectTimeoutRef.current = setTimeout(() => {
                    if (!cancelled) {
                        setReconnectCounter((c) => c + 1)
                    }
                }, 3000)
            }
        }

        return () => {
            cancelled = true
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current)
                reconnectTimeoutRef.current = null
            }
            wsRef.current?.close()
            wsRef.current = null
        }
    }, [url, autoConnect, reconnectCounter])

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
