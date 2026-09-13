import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { env } from '@/lib/env'
import { useAppAuth } from '@/lib/auth'
import { addWebSocketBreadcrumb } from '@/lib/sentry'
import type { LogEntry } from '@/lib/logs'

export interface AutomationProgress {
  totalAccounts: number
  currentProfile: string | null
  currentTask: string | null
}

import type { WorkerEvent } from '../../../server/shared/contracts'
export type WebSocketMessage = WorkerEvent

interface UseWebSocketOptions {
  url?: string
  autoConnect?: boolean
  enabled?: boolean
  pauseWhenHidden?: boolean
  maxBuffer?: number
  eventsOnly?: boolean
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

export function parseLogEntry(
  data: WebSocketMessage,
  currentProfile: string | null,
): LogEntry {
  return {
    id: data.id,
    message: data.message!,
    level: data.level || 'info',
    source: data.source || 'unknown',
    workflowId: (data.workflowId) ?? undefined,
    profileName: data.profileName || currentProfile || undefined,
    taskId: data.taskId || undefined,
    targetUsername: data.targetUsername || undefined,
    errorCode: data.errorCode || undefined,
    outcome: data.outcome || undefined,
    attempt: typeof data.attempt === 'number' ? data.attempt : undefined,
    diagnostics: typeof data.diagnostics === 'string' ? data.diagnostics : undefined,
    ts: typeof data.ts === 'number' ? data.ts : Date.parse(data.ts || '') || Date.now(),
  }
}

/* ── Check if message matches the workflow filter ── */

function matchesWorkflowFilter(
  data: WebSocketMessage,
  activeWorkflowId: string | null,
): boolean {
  const msgWorkflowId = data.workflowId ?? null
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
    setProgress({ totalAccounts: data.totalAccounts || 0, currentProfile: null, currentTask: null })
  } else if (data.type === 'profile_started') {
    currentProfileRef.current = data.profileName || null
    setProgress((prev) => ({ ...prev, currentProfile: data.profileName || null, currentTask: null }))
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
  eventsOnly: boolean,
  onEvent: ((message: WebSocketMessage) => void) | undefined,
  currentProfileRef: React.MutableRefObject<string | null>,
  setLogs: React.Dispatch<React.SetStateAction<LogEntry[]>>,
  setStatus: React.Dispatch<React.SetStateAction<'idle' | 'running' | 'stopping'>>,
  setProgress: React.Dispatch<React.SetStateAction<AutomationProgress>>,
) {
  try {
    const data: WebSocketMessage = JSON.parse(rawMessage)
    try { onEvent?.(data) } catch { /* ignore */ }
    if (eventsOnly) return
    const activeWorkflowId = workflowId ?? null
    const msgWorkflowId = data.workflowId ?? null
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

/* ── Safely close a WebSocket if it is not already closed ── */

function safeCloseSocket(ws: WebSocket | null) {
  if (!ws) return
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    ws.close()
  }
}

/* ── Connect a WebSocket and wire event handlers ── */

async function connectWebSocket(
  wsUrl: string,
  getToken: () => Promise<string | null>,
  handleSocketMessage: (rawMessage: string) => void,
  setConnected: (v: boolean) => void,
  wsRef: React.MutableRefObject<WebSocket | null>,
  connectingRef: React.MutableRefObject<boolean>,
  cancelled: { current: boolean },
) {
  connectingRef.current = true
  let tokenParam = ''
  try {
    const token = await getToken()
    if (token) tokenParam = `?token=${encodeURIComponent(token)}`
  } catch { /* continue */ }
  if (cancelled.current) { connectingRef.current = false; return }

  // Close any lingering socket before creating a new one
  safeCloseSocket(wsRef.current)
  wsRef.current = null

  const ws = new WebSocket(`${wsUrl}${tokenParam}`)
  wsRef.current = ws

  ws.onopen = () => {
    connectingRef.current = false
    if (cancelled.current) { ws.close(); return }
    setConnected(true)
    addWebSocketBreadcrumb('open', wsUrl)
  }
  ws.onmessage = (event) => {
    if (!cancelled.current) handleSocketMessage(event.data)
  }
  ws.onerror = () => {
    connectingRef.current = false
    addWebSocketBreadcrumb('error', wsUrl)
    ws.close()
  }
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

/* ── Connection effect cleanup helper ── */

function cleanupConnection(
  cancelled: { current: boolean },
  reconnectTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  wsRef: React.MutableRefObject<WebSocket | null>,
  connectingRef: React.MutableRefObject<boolean>,
  setConnected?: (v: boolean) => void,
) {
  cancelled.current = true
  if (reconnectTimeoutRef.current) {
    clearTimeout(reconnectTimeoutRef.current)
    reconnectTimeoutRef.current = null
  }
  safeCloseSocket(wsRef.current)
  wsRef.current = null
  connectingRef.current = false
  setConnected?.(false)
}

/* ── Main hook ── */

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    url, autoConnect = true, enabled = true,
    pauseWhenHidden = false, maxBuffer = 500,
    workflowId, onEvent, eventsOnly = false,
  } = options
  const wsUrl = url ?? getDefaultWebSocketUrl()
  const { getToken } = useAppAuth()

  const [logs, setLogs] = useState<LogEntry[]>([])
  const [status, setStatus] = useState<'idle' | 'running' | 'stopping'>('idle')
  const [progress, setProgress] = useState<AutomationProgress>(
    { totalAccounts: 0, currentProfile: null, currentTask: null })
  const documentVisible = useVisibility()
  const isVisible = !pauseWhenHidden || documentVisible
  const wsRef = useRef<WebSocket | null>(null)
  const connectingRef = useRef(false)
  const intentionalDisconnectRef = useRef(false)
  const currentProfileRef = useRef<string | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptRef = useRef(0)
  // Holds a reference to the effect-scoped cancelled flag so disconnect() can reach it
  const cancelledRef = useRef<{ current: boolean }>({ current: false })

  const handleSocketMessage = useEffectEvent((rawMessage: string) => {
    processSocketMessage(
      rawMessage, workflowId, maxBuffer, eventsOnly, onEvent,
      currentProfileRef, setLogs, setStatus, setProgress,
    )
  })

  const clearLogs = useCallback(() => { setLogs([]) }, [])
  const [connected, setConnected] = useState(false)
  const [reconnectCounter, setReconnectCounter] = useState(0)

  useEffect(() => {
    if (!enabled || (pauseWhenHidden && !isVisible)) return
    if (!autoConnect && reconnectCounter === 0) return
    const rs = wsRef.current?.readyState
    if (rs === WebSocket.OPEN || rs === WebSocket.CONNECTING) return
    if (connectingRef.current) return

    intentionalDisconnectRef.current = false
    const cancelled = { current: false }
    cancelledRef.current = cancelled
    const reconnectArgs = { autoConnect, enabled, pauseWhenHidden, isVisible }

    void connectWebSocket(
      wsUrl, getToken, handleSocketMessage,
      (v) => { setConnected(v); if (v) reconnectAttemptRef.current = 0 },
      wsRef, connectingRef, cancelled,
    ).then((ws) => {
      if (!ws) return
      ws.onclose = () => {
        connectingRef.current = false
        if (cancelled.current) return
        setConnected(false); wsRef.current = null
        addWebSocketBreadcrumb('close', wsUrl)
        if (!intentionalDisconnectRef.current) {
          scheduleReconnect(reconnectArgs.autoConnect, reconnectArgs.enabled,
            reconnectArgs.pauseWhenHidden, reconnectArgs.isVisible, cancelled,
            reconnectAttemptRef, reconnectTimeoutRef, setReconnectCounter)
        }
      }
    }).catch(() => {
      connectingRef.current = false
      if (!intentionalDisconnectRef.current) {
        scheduleReconnect(reconnectArgs.autoConnect, reconnectArgs.enabled,
          reconnectArgs.pauseWhenHidden, reconnectArgs.isVisible, cancelled,
          reconnectAttemptRef, reconnectTimeoutRef, setReconnectCounter)
      }
    })

    return () => cleanupConnection(cancelled, reconnectTimeoutRef, wsRef, connectingRef, setConnected)
  }, [wsUrl, autoConnect, enabled, pauseWhenHidden, reconnectCounter, getToken, isVisible,
    wsRef, reconnectAttemptRef, reconnectTimeoutRef])

  const connect = useCallback(() => { setReconnectCounter((c) => c + 1) }, [])
  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true
    cleanupConnection(cancelledRef.current, reconnectTimeoutRef, wsRef, connectingRef, setConnected)
  }, [])

  return { logs, status, progress, connected, clearLogs, connect, disconnect }
}
