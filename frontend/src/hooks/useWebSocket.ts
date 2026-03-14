import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useAuth } from '@clerk/react-router'
import { env } from '@/lib/env'
import { addWebSocketBreadcrumb } from '@/lib/sentry'

export interface LogEntry {
  message: string
  level: string
  source: string
  workflowId?: string
  profileName?: string
  taskId?: string
  targetUsername?: string
  errorCode?: string
  outcome?: string
  attempt?: number
  diagnostics?: string
  ts: number
}

export interface AutomationProgress {
  totalAccounts: number
  currentProfile: string | null
  currentTask: string | null
}

interface WebSocketMessage {
  type:
    | 'log'
    | 'status'
    | 'workflow_status'
    | 'error'
    | 'session_started'
    | 'profile_started'
    | 'task_started'
    | 'profile_completed'
    | 'session_ended'
    | 'display_allocated'
    | 'display_released'
  message?: string
  level?: string
  source?: string
  status?: string
  workflowId?: string
  workflow_id?: string
  total_accounts?: number
  profile?: string
  profileName?: string
  taskId?: string
  targetUsername?: string
  errorCode?: string
  outcome?: string
  attempt?: number
  diagnostics?: string
  task?: string
  vnc_port?: number
  vncPort?: number
  display_num?: number
  displayNum?: number
}

interface UseWebSocketOptions {
  url?: string
  autoConnect?: boolean
  enabled?: boolean
  pauseWhenHidden?: boolean
  maxBuffer?: number
  workflowId?: string | null
  onEvent?: (message: WebSocketMessage) => void
}

// Reconnection backoff constants
const BASE_RECONNECT_DELAY = 1000
const MAX_RECONNECT_DELAY = 30000

function getDefaultWebSocketUrl() {
  if (typeof window === 'undefined') return 'ws://localhost:3001/ws'
  try {
    const apiUrl = new URL(env.apiUrl, window.location.origin)
    const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${apiUrl.host}/ws`
  } catch {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws`
  }
}

function getReconnectDelay(attempt: number): number {
  const delay = Math.min(
    BASE_RECONNECT_DELAY * Math.pow(2, attempt),
    MAX_RECONNECT_DELAY,
  )
  const jitter = delay * 0.2 * Math.random()
  return delay + jitter
}

/* ── Parse a log entry from WebSocket message ── */

function parseLogEntry(
  data: WebSocketMessage,
  currentProfile: string | null,
): LogEntry {
  return {
    message: data.message!,
    level: data.level || 'info',
    source: data.source || 'unknown',
    workflowId: (data.workflowId ?? data.workflow_id) ?? undefined,
    profileName: data.profileName || currentProfile || undefined,
    taskId: data.taskId || undefined,
    targetUsername: data.targetUsername || undefined,
    errorCode: data.errorCode || undefined,
    outcome: data.outcome || undefined,
    attempt: typeof data.attempt === 'number' ? data.attempt : undefined,
    diagnostics: typeof data.diagnostics === 'string' ? data.diagnostics : undefined,
    ts: Date.now(),
  }
}

/* ── Check if message matches the workflow filter ── */

function matchesWorkflowFilter(
  data: WebSocketMessage,
  activeWorkflowId: string | null,
): boolean {
  const msgWorkflowId = data.workflowId ?? data.workflow_id ?? null
  if (!activeWorkflowId) return true
  return msgWorkflowId === activeWorkflowId
}

/* ── Handle progress-related messages (pure function) ── */

function handleProgressUpdate(
  data: WebSocketMessage,
  currentProfileRef: React.MutableRefObject<string | null>,
  setProgress: React.Dispatch<React.SetStateAction<AutomationProgress>>,
) {
  if (data.type === 'session_started') {
    setProgress({ totalAccounts: data.total_accounts || 0, currentProfile: null, currentTask: null })
  } else if (data.type === 'profile_started') {
    currentProfileRef.current = data.profile || null
    setProgress((prev) => ({ ...prev, currentProfile: data.profile || null, currentTask: null }))
  } else if (data.type === 'task_started') {
    setProgress((prev) => ({ ...prev, currentTask: data.task || null }))
  } else if (data.type === 'profile_completed') {
    currentProfileRef.current = null
    setProgress((prev) => ({ ...prev, currentProfile: null, currentTask: null }))
  }
}

/* ── Visibility tracking ── */

function useVisibility() {
  const [isVisible, setIsVisible] = useState(() => {
    if (typeof document === 'undefined') return true
    return document.visibilityState !== 'hidden'
  })

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibilityChange = () => {
      setIsVisible(document.visibilityState !== 'hidden')
    }
    onVisibilityChange()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  return isVisible
}

/* ── Message processing (plain fn, no hooks) ── */

function processSocketMessage(
  rawMessage: string,
  workflowId: string | null | undefined,
  maxBuffer: number,
  onEvent: ((message: WebSocketMessage) => void) | undefined,
  currentProfileRef: React.MutableRefObject<string | null>,
  setLogs: React.Dispatch<React.SetStateAction<LogEntry[]>>,
  setStatus: React.Dispatch<React.SetStateAction<'idle' | 'running' | 'stopping'>>,
  setProgress: React.Dispatch<React.SetStateAction<AutomationProgress>>,
) {
  try {
    const data: WebSocketMessage = JSON.parse(rawMessage)
    try { onEvent?.(data) } catch { /* ignore */ }
    const activeWorkflowId = workflowId ?? null
    const msgWorkflowId = data.workflowId ?? data.workflow_id ?? null
    const matches = matchesWorkflowFilter(data, activeWorkflowId)

    if (data.type === 'log' && data.message) {
      if (!matches) return
      if (activeWorkflowId && !msgWorkflowId) return
      const entry = parseLogEntry(data, currentProfileRef.current)
      setLogs((prev) => {
        const next = prev.length >= maxBuffer ? prev.slice(-(maxBuffer - 1)) : prev
        return [...next, entry]
      })
    } else if (data.type === 'status' && data.status) {
      if (activeWorkflowId || msgWorkflowId) return
      setStatus(data.status as 'idle' | 'running' | 'stopping')
    } else if (data.type === 'workflow_status' && data.status) {
      if (!matches || (activeWorkflowId && !msgWorkflowId)) return
      setStatus(data.status as 'idle' | 'running' | 'stopping')
    } else if (matches && !(activeWorkflowId && !msgWorkflowId)) {
      handleProgressUpdate(data, currentProfileRef, setProgress)
    }
  } catch { /* ignore parse errors */ }
}

/* ── Connect a WebSocket and wire event handlers ── */

async function connectWebSocket(
  wsUrl: string,
  getToken: () => Promise<string | null>,
  handleSocketMessage: (rawMessage: string) => void,
  setConnected: (v: boolean) => void,
  wsRef: React.MutableRefObject<WebSocket | null>,
  cancelled: { current: boolean },
) {
  let tokenParam = ''
  try {
    const token = await getToken()
    if (token) tokenParam = `?token=${encodeURIComponent(token)}`
  } catch { /* continue */ }
  if (cancelled.current) return
  const ws = new WebSocket(`${wsUrl}${tokenParam}`)
  ws.onopen = () => {
    if (cancelled.current) { ws.close(); return }
    setConnected(true)
    addWebSocketBreadcrumb('open', wsUrl)
  }
  ws.onmessage = (event) => {
    if (!cancelled.current) handleSocketMessage(event.data)
  }
  ws.onerror = () => { addWebSocketBreadcrumb('error', wsUrl); ws.close() }
  wsRef.current = ws
  return ws
}

/* ── Schedule reconnection with backoff ── */

function scheduleReconnect(
  autoConnect: boolean,
  enabled: boolean,
  pauseWhenHidden: boolean,
  isVisible: boolean,
  cancelled: { current: boolean },
  reconnectAttemptRef: React.MutableRefObject<number>,
  reconnectTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  setReconnectCounter: React.Dispatch<React.SetStateAction<number>>,
) {
  if (autoConnect && enabled && (!pauseWhenHidden || isVisible) && !cancelled.current) {
    const delay = getReconnectDelay(reconnectAttemptRef.current++)
    reconnectTimeoutRef.current = setTimeout(() => {
      if (!cancelled.current) setReconnectCounter((c) => c + 1)
    }, delay)
  }
}

/* ── Main hook ── */

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    url, autoConnect = true, enabled = true,
    pauseWhenHidden = false, maxBuffer = 500,
    workflowId, onEvent,
  } = options
  const wsUrl = url ?? getDefaultWebSocketUrl()
  const { getToken } = useAuth()

  const [logs, setLogs] = useState<LogEntry[]>([])
  const [status, setStatus] = useState<'idle' | 'running' | 'stopping'>('idle')
  const [progress, setProgress] = useState<AutomationProgress>({
    totalAccounts: 0, currentProfile: null, currentTask: null,
  })
  const isVisible = useVisibility()
  const wsRef = useRef<WebSocket | null>(null)
  const currentProfileRef = useRef<string | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptRef = useRef(0)

  const handleSocketMessage = useEffectEvent((rawMessage: string) => {
    processSocketMessage(
      rawMessage, workflowId, maxBuffer, onEvent,
      currentProfileRef, setLogs, setStatus, setProgress,
    )
  })

  const clearLogs = useCallback(() => { setLogs([]) }, [])

  const [connected, setConnected] = useState(false)
  const [reconnectCounter, setReconnectCounter] = useState(0)

  useEffect(() => {
    if (!enabled || (pauseWhenHidden && !isVisible)) return
    if (!autoConnect && reconnectCounter === 0) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const cancelled = { current: false }
    void connectWebSocket(
      wsUrl, getToken, handleSocketMessage,
      (v) => { setConnected(v); if (v) reconnectAttemptRef.current = 0 },
      wsRef, cancelled,
    ).then((ws) => {
      if (!ws) return
      ws.onclose = () => {
        if (cancelled.current) return
        setConnected(false); wsRef.current = null
        addWebSocketBreadcrumb('close', wsUrl)
        scheduleReconnect(autoConnect, enabled, pauseWhenHidden, isVisible, cancelled,
          reconnectAttemptRef, reconnectTimeoutRef, setReconnectCounter)
      }
    }).catch(() => {
      scheduleReconnect(autoConnect, enabled, pauseWhenHidden, isVisible, cancelled,
        reconnectAttemptRef, reconnectTimeoutRef, setReconnectCounter)
    })
    return () => {
      cancelled.current = true
      if (reconnectTimeoutRef.current) { clearTimeout(reconnectTimeoutRef.current); reconnectTimeoutRef.current = null }
      wsRef.current?.close(); wsRef.current = null
    }
  }, [wsUrl, autoConnect, enabled, pauseWhenHidden, reconnectCounter, getToken, isVisible,
    wsRef, reconnectAttemptRef, reconnectTimeoutRef])

  const connect = useCallback(() => { setReconnectCounter((c) => c + 1) }, [])

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) { clearTimeout(reconnectTimeoutRef.current); reconnectTimeoutRef.current = null }
    wsRef.current?.close(); wsRef.current = null; setConnected(false)
  }, [])

  return { logs, status, progress, connected, clearLogs, connect, disconnect }
}
