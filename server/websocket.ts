import { WebSocketServer, WebSocket } from 'ws'
import { Server } from 'http'
import { clients } from './shared/store.js'
import { verifySessionUid } from './auth/telegram.js'
import { isLocalAuthBypassEnabled } from './security/auth.js'
import { LogScope } from './shared/logger.js'
import { matchesSubscription, parseSubscription } from './shared/subscriptions.js'

const LOCAL_AUTH_BYPASS = isLocalAuthBypassEnabled()

export function initWebSocket(server: Server, path: string = '/ws') {
    const wss = new WebSocketServer({ server, path })

    wss.on('connection', async (ws, req) => {
        const scope = new LogScope('websocket.connection', { path, authMode: LOCAL_AUTH_BYPASS ? 'local' : 'session' })
        ws.once('close', (code) => {
            clients.delete(ws)
            scope.add({ closeCode: code })
            scope.finish()
        })
        ws.on('error', error => { scope.add({ error, outcome: 'error' }) })
        // Extract token from query string: /ws?token=xxx
        const url = new URL(req.url || '', `http://${req.headers.host}`)
        const token = url.searchParams.get('token')

        if (!LOCAL_AUTH_BYPASS && !token) {
            scope.add({ outcome: 'rejected', reason: 'missing_auth' })
            ws.close(4001, 'Missing auth token')
            return
        }

        if (!LOCAL_AUTH_BYPASS) {
            if (!token || !verifySessionUid(token)) {
                scope.add({ outcome: 'rejected', reason: 'invalid_auth' })
                ws.close(4003, 'Invalid auth token')
                return
            }
        }

        clients.add(Object.assign(ws, { subscription: parseSubscription(url.searchParams) }))
        scope.add({ topic: parseSubscription(url.searchParams).topic })
    })

    return wss
}

export function broadcast(data: object) {
    if (clients.size === 0) return
    const message = JSON.stringify(data)
    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && matchesSubscription(data, client.subscription)) {
            sendBounded(client, message)
        }
    })
}

/** Drop stalled clients rather than retaining an unlimited outbound queue. */
export function sendBounded(client: WebSocket, message: string, maxBytes = 1024 * 1024): void {
    if (client.bufferedAmount + Buffer.byteLength(message) > maxBytes) {
        clients.delete(client)
        client.terminate()
        return
    }
    client.send(message, error => { if (error) { clients.delete(client); client.terminate() } })
}
