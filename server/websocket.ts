
import { WebSocketServer, WebSocket } from 'ws'
import { Server } from 'http'
import { clients, logsStore, MAX_LOGS, automationState } from './store.js'
import { appendLog as appendFileLog } from './lib/logStore.js'

export function initWebSocket(server: Server, path: string = '/ws') {
    const wss = new WebSocketServer({ server, path })

    wss.on('connection', (ws) => {
        clients.add(ws)
        console.log('[WS] Client connected')

        // Send current status
        ws.send(JSON.stringify({ type: 'status', status: automationState.status }))

        ws.on('close', () => {
            clients.delete(ws)
            console.log('[WS] Client disconnected')
        })
    })

    return wss
}

export function broadcast(data: object) {
    const message = JSON.stringify(data)

    // Store log entries
    if ('type' in data && (data as any).type === 'log') {
        const logEntry = {
            message: (data as any).message || '',
            level: (data as any).level || 'info',
            source: (data as any).source || 'unknown',
            ts: Date.now()
        }
        logsStore.push(logEntry)
        if (logsStore.length > MAX_LOGS) {
            logsStore.shift()
        }
        appendFileLog(logEntry.message, logEntry.source, logEntry.level as any)
    }

    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message)
        }
    })
}
