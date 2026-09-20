import { randomUUID } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'
import { Server } from 'http'
import { clients, logsStore, MAX_LOGS } from './shared/store.js'
import { verifySessionUid } from './auth/telegram.js'
import { isLocalAuthBypassEnabled } from './security/auth.js'
import logger from './shared/logger.js'
import { matchesSubscription, parseSubscription } from './shared/subscriptions.js'

const LOCAL_AUTH_BYPASS = isLocalAuthBypassEnabled()

export function initWebSocket(server: Server, path: string = '/ws') {
    const wss = new WebSocketServer({ server, path })

    wss.on('connection', async (ws, req) => {
        // Extract token from query string: /ws?token=xxx
        const url = new URL(req.url || '', `http://${req.headers.host}`)
        const token = url.searchParams.get('token')

        if (!LOCAL_AUTH_BYPASS && !token) {
            ws.close(4001, 'Missing auth token')
            return
        }

        if (!LOCAL_AUTH_BYPASS) {
            if (!token || !verifySessionUid(token)) {
                ws.close(4003, 'Invalid auth token')
                return
            }
        }

        clients.add(Object.assign(ws, { subscription: parseSubscription(url.searchParams) }))
        logger.info(
            LOCAL_AUTH_BYPASS
                ? 'WebSocket client connected (local auth bypass)'
                : 'WebSocket client connected (authenticated)',
        )


        ws.on('close', () => {
            clients.delete(ws)
            logger.info('WebSocket client disconnected')
        })
    })

    return wss
}

export function broadcast(data: object) {
    // Store log entries
    if ('type' in data && (data as any).type === 'log') {
        const logEntry = {
            id: randomUUID(),
            message: (data as any).message || '',
            level: (data as any).level || 'info',
            source: (data as any).source || 'unknown',
            profileName: (data as any).profileName,
            automationId: (data as any).automationId,
            taskId: (data as any).taskId,
            targetUsername: (data as any).targetUsername,
            errorCode: (data as any).errorCode,
            outcome: (data as any).outcome,
            diagnostics: (data as any).diagnostics,
            attempt:
                typeof (data as any).attempt === 'number'
                    ? (data as any).attempt
                    : undefined,
            ts: Date.now()
        }
        data = { type: 'log', ...logEntry }
        logsStore.push(logEntry)
        if (logsStore.length > MAX_LOGS) {
            logsStore.shift()
        }
    }

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
