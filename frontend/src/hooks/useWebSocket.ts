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

import type { SocketTopic, WorkerEvent } from '../../../server/shared/contracts'
export type WebSocketMessage = WorkerEvent

interface UseWebSocketOptions {
  url?: string
  autoConnect?: boolean
  enabled?: boolean
  pauseWhenHidden?: boolean
  maxBuffer?: number
  eventsOnly?: boolean
  automationId?: string | null
  topic?: SocketTopic
  profileName?: string | null
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
    automationId: (data.automationId) ?? undefined,
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

/* ── Check if message matches the automation filter ── */

function matchesAutomationFilter(
  data: WebSocketMessage,
  activeAutomationId: string | null,
): boolean {
  const msgAutomationId = data.automationId ?? null
  if (!activeAutomationId) return true
  return msgAutomationId === activeAutomationId
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
  options: {
    automationId?: string | null
    maxBuffer: number
    eventsOnly: boolean
    onEvent?: (message: WebSocketMessage) => void
    currentProfileRef: React.MutableRefObject<string | null>
    setLogs: React.Dispatch<React.SetStateAction<LogEntry[]>>
    setStatus: React.Dispatch<React.SetStateAction<'idle' | 'running' | 'stopping'>>
    setProgress: React.Dispatch<React.SetStateAction<AutomationProgress>>
  },
) {
  const { automationId, maxBuffer, eventsOnly, onEvent, currentProfileRef, setLogs, setStatus, setProgress } = options
  try {
    const data: WebSocketMessage = JSON.parse(rawMessage)
    try { onEvent?.(data) } catch { /* ignore */ }
    if (eventsOnly) return
    const activeAutomationId = automationId ?? null
    const msgAutomationId = data.automationId ?? null
    const matches = matchesAutomationFilter(data, activeAutomationId)

    if (data.type === 'log' && data.message) {
      if (!matches) return
      if (activeAutomationId && !msgAutomationId) return
      const entry = parseLogEntry(data, currentProfileRef.current)
      setLogs((prev) => {
        const next = prev.length >= maxBuffer ? prev.slice(-(maxBuffer - 1)) : prev
        return [...next, entry]
      })
    } else if (data.type === 'status' && data.status) {
      if (activeAutomationId || msgAutomationId) return
      setStatus(data.status as 'idle' | 'running' | 'stopping')
    } else if (data.type === 'automation_status' && data.status) {
      if (!matches || (activeAutomationId && !msgAutomationId)) return
      setStatus(data.status as 'idle' | 'running' | 'stopping')
    } else if (matches && !(activeAutomationId && !msgAutomationId)) {
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

type SocketConnection = {
  ws: WebSocket | null
  connecting: boolean
  intentionalDisconnect: boolean
  reconnectTimer: ReturnType<typeof setTimeout> | null
  reconnectAttempt: number
  cancelled: { current: boolean }
}

async function connectWebSocket(options: {
  wsUrl: string
  getToken: () => Promise<string | null>
  onMessage: (rawMessage: string) => void
  onConnected: (connected: boolean) => void
  connection: SocketConnection
  cancelled: { current: boolean }
}) {
  const { wsUrl, getToken, onMessage, onConnected, connection, cancelled } = options
  connection.connecting = true
  const connectionUrl = new URL(wsUrl)
  try {
    const token = await getToken()
    if (token) connectionUrl.searchParams.set('token', token)
  } catch { /* continue */ }
  if (cancelled.current) { connection.connecting = false; return }

  // Close any lingering socket before creating a new one
  safeCloseSocket(connection.ws)
  connection.ws = null

  const ws = new WebSocket(connectionUrl.toString())
  connection.ws = ws

  ws.onopen = () => {
    connection.connecting = false
    if (cancelled.current) { ws.close(); return }
    onConnected(true)
    addWebSocketBreadcrumb('open', wsUrl)
  }
  ws.onmessage = (event) => {
    if (!cancelled.current) onMessage(event.data)
  }
  ws.onerror = () => {
    connection.connecting = false
    addWebSocketBreadcrumb('error', wsUrl)
    ws.close()
  }
  return ws
}

/* ── Schedule reconnection with backoff ── */

function scheduleReconnect(options: {
  autoConnect: boolean
  enabled: boolean
  isVisible: boolean
  connection: SocketConnection
  cancelled: { current: boolean }
  retry: () => void
}) {
  const { autoConnect, enabled, isVisible, connection, cancelled, retry } = options
  if (autoConnect && enabled && isVisible && !cancelled.current) {
    const delay = getReconnectDelay(connection.reconnectAttempt++)
    connection.reconnectTimer = setTimeout(() => {
      if (!cancelled.current) retry()
    }, delay)
  }
}

/* ── Connection effect cleanup helper ── */

function cleanupConnection(connection: SocketConnection, cancelled: { current: boolean }, setConnected: (v: boolean) => void) {
  cancelled.current = true
  if (connection.reconnectTimer) {
    clearTimeout(connection.reconnectTimer)
    connection.reconnectTimer = null
  }
  safeCloseSocket(connection.ws)
  connection.ws = null
  connection.connecting = false
  setConnected(false)
}

/* ── Main hook ── */

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    url, autoConnect = true, enabled = true,
    pauseWhenHidden = false, maxBuffer = 500,
    automationId, onEvent, eventsOnly = false, topic = 'all', profileName,
  } = options
  const defaultUrl = getDefaultWebSocketUrl()
  const subscriptionUrl = new URL(url ?? defaultUrl, defaultUrl)
  subscriptionUrl.searchParams.set('topic', topic)
  if (topic === 'logs') {
    if (automationId) subscriptionUrl.searchParams.set('automationId', automationId)
    if (profileName) subscriptionUrl.searchParams.set('profileName', profileName)
  }
  const wsUrl = subscriptionUrl.toString()
  const { getToken } = useAppAuth()

  const [logs, setLogs] = useState<LogEntry[]>([])
  const [status, setStatus] = useState<'idle' | 'running' | 'stopping'>('idle')
  const [progress, setProgress] = useState<AutomationProgress>(
    { totalAccounts: 0, currentProfile: null, currentTask: null })
  const documentVisible = useVisibility()
  const isVisible = !pauseWhenHidden || documentVisible
  const connectionRef = useRef<SocketConnection>({
    ws: null,
    connecting: false,
    intentionalDisconnect: false,
    reconnectTimer: null,
    reconnectAttempt: 0,
    cancelled: { current: false },
  })
  const currentProfileRef = useRef<string | null>(null)

  const handleSocketMessage = useEffectEvent((rawMessage: string) => {
    processSocketMessage(rawMessage, {
      automationId, maxBuffer, eventsOnly, onEvent,
      currentProfileRef, setLogs, setStatus, setProgress,
    })
  })

  const clearLogs = useCallback(() => { setLogs([]) }, [])
  const [connected, setConnected] = useState(false)
  const [reconnectCounter, setReconnectCounter] = useState(0)

  useEffect(() => {
    if (!enabled || (pauseWhenHidden && !isVisible)) return
    if (!autoConnect && reconnectCounter === 0) return
    const connection = connectionRef.current
    const rs = connection.ws?.readyState
    if (rs === WebSocket.OPEN || rs === WebSocket.CONNECTING) return
    if (connection.connecting) return

    connection.intentionalDisconnect = false
    const cancelled = { current: false }
    connection.cancelled = cancelled
    const reconnect = () => scheduleReconnect({
      autoConnect, enabled, isVisible, connection, cancelled,
      retry: () => setReconnectCounter((count) => count + 1),
    })

    void connectWebSocket({
      wsUrl, getToken, onMessage: handleSocketMessage,
      onConnected: (connected) => {
        setConnected(connected)
        if (connected) connection.reconnectAttempt = 0
      },
      connection, cancelled,
    }).then((ws) => {
      if (!ws) return
      ws.onclose = () => {
        connection.connecting = false
        if (cancelled.current) return
        setConnected(false)
        connection.ws = null
        addWebSocketBreadcrumb('close', wsUrl)
        if (!connection.intentionalDisconnect) reconnect()
      }
    }).catch(() => {
      connection.connecting = false
      if (!connection.intentionalDisconnect) reconnect()
    })

    return () => cleanupConnection(connection, cancelled, setConnected)
  }, [wsUrl, autoConnect, enabled, pauseWhenHidden, reconnectCounter, getToken, isVisible])

  const connect = useCallback(() => { setReconnectCounter((c) => c + 1) }, [])
  const disconnect = useCallback(() => {
    const connection = connectionRef.current
    connection.intentionalDisconnect = true
    cleanupConnection(connection, connection.cancelled, setConnected)
  }, [])

  return { logs, status, progress, connected, clearLogs, connect, disconnect }
}
