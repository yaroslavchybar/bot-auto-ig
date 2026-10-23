import { useDocumentVisibility } from './use-document-visibility'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { env } from '@/lib/env'
import { useAppAuth } from '@/lib/auth'
import { addWebSocketBreadcrumb } from '@/lib/sentry'

import type { SocketTopic, WorkerEvent } from '../../../server/shared/contracts'
export type WebSocketMessage = WorkerEvent

interface UseWebSocketOptions {
  url?: string
  enabled?: boolean
  pauseWhenHidden?: boolean
  topic?: SocketTopic
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
  const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, attempt), MAX_RECONNECT_DELAY)
  const jitter = delay * 0.2 * Math.random()
  return delay + jitter
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
  reconnectTimer: ReturnType<typeof setTimeout> | null
  reconnectAttempt: number
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
  } catch {
    /* continue */
  }
  if (cancelled.current) {
    connection.connecting = false
    return
  }

  // Close any lingering socket before creating a new one
  safeCloseSocket(connection.ws)
  connection.ws = null

  const ws = new WebSocket(connectionUrl.toString())
  connection.ws = ws

  ws.onopen = () => {
    connection.connecting = false
    if (cancelled.current) {
      ws.close()
      return
    }
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
  connection: SocketConnection
  cancelled: { current: boolean }
  retry: () => void
}) {
  const { connection, cancelled, retry } = options
  if (!cancelled.current) {
    const delay = getReconnectDelay(connection.reconnectAttempt++)
    connection.reconnectTimer = setTimeout(() => {
      if (!cancelled.current) retry()
    }, delay)
  }
}

/* ── Connection effect cleanup helper ── */

function cleanupConnection(
  connection: SocketConnection,
  cancelled: { current: boolean },
  setConnected: (v: boolean) => void,
) {
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
    url,
    enabled = true,
    pauseWhenHidden = false,
    onEvent,
    topic = 'all',
  } = options
  const defaultUrl = getDefaultWebSocketUrl()
  const subscriptionUrl = new URL(url ?? defaultUrl, defaultUrl)
  subscriptionUrl.searchParams.set('topic', topic)
  const wsUrl = subscriptionUrl.toString()
  const { getToken } = useAppAuth()

  const documentVisible = useDocumentVisibility()
  const isVisible = !pauseWhenHidden || documentVisible
  const connectionRef = useRef<SocketConnection>({
    ws: null,
    connecting: false,
    reconnectTimer: null,
    reconnectAttempt: 0,
  })

  const handleSocketMessage = useEffectEvent((rawMessage: string) => {
    try {
      onEvent?.(JSON.parse(rawMessage) as WebSocketMessage)
    } catch {
      // Malformed events and consumer failures must not disconnect the stream.
    }
  })

  const [connected, setConnected] = useState(false)
  const [reconnectCounter, setReconnectCounter] = useState(0)

  useEffect(() => {
    if (!enabled || (pauseWhenHidden && !isVisible)) return
    const connection = connectionRef.current
    const rs = connection.ws?.readyState
    if (rs === WebSocket.OPEN || rs === WebSocket.CONNECTING) return
    if (connection.connecting) return

    const cancelled = { current: false }
    const reconnect = () =>
      scheduleReconnect({
        connection,
        cancelled,
        retry: () => setReconnectCounter((count) => count + 1),
      })

    void connectWebSocket({
      wsUrl,
      getToken,
      onMessage: handleSocketMessage,
      onConnected: (connected) => {
        setConnected(connected)
        if (connected) connection.reconnectAttempt = 0
      },
      connection,
      cancelled,
    })
      .then((ws) => {
        if (!ws) return
        ws.onclose = () => {
          connection.connecting = false
          if (cancelled.current) return
          setConnected(false)
          connection.ws = null
          addWebSocketBreadcrumb('close', wsUrl)
          reconnect()
        }
      })
      .catch(() => {
        connection.connecting = false
        reconnect()
      })

    return () => cleanupConnection(connection, cancelled, setConnected)
  }, [wsUrl, enabled, pauseWhenHidden, reconnectCounter, getToken, isVisible])

  return { connected }
}
