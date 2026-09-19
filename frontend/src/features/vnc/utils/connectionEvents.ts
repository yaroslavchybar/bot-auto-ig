export type OverlayState = { tone: 'info' | 'error'; text: string } | null
export type ConnectionLifecycle = { disposed: boolean; terminalFailure: boolean }

export function attachRfbListeners(
  rfb: EventTarget,
  lifecycle: ConnectionLifecycle,
  clearReconnectTimer: () => void,
  reconnectAttempt: { current: number },
  setOverlay: (state: OverlayState) => void,
  scheduleReconnect: () => void,
) {
  rfb.addEventListener('connect', () => {
    if (lifecycle.disposed || lifecycle.terminalFailure) return
    reconnectAttempt.current = 0
    clearReconnectTimer()
    setOverlay(null)
  })
  rfb.addEventListener('disconnect', () => {
    // noVNC also marks server-initiated closes as clean. Only our own cleanup
    // or a terminal handshake error should prevent reconnecting.
    if (!lifecycle.disposed && !lifecycle.terminalFailure) scheduleReconnect()
  })
  rfb.addEventListener('securityfailure', (event) => {
    if (lifecycle.disposed) return
    lifecycle.terminalFailure = true
    clearReconnectTimer()
    const { reason, status } = (event as CustomEvent<{ reason?: string; status?: number }>).detail ?? {}
    setOverlay({ tone: 'error', text: reason || (status ? `Security handshake failed (code ${status}).` : 'Security handshake failed.') })
  })
  rfb.addEventListener('credentialsrequired', () => {
    if (lifecycle.disposed) return
    lifecycle.terminalFailure = true
    clearReconnectTimer()
    setOverlay({ tone: 'error', text: 'Display requested credentials.' })
  })
}
