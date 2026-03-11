import { WebSocketServer, WebSocket } from 'ws'
import { Server } from 'http'
import { clients, logsStore, MAX_LOGS, automationState } from './store.js'
import { appendLog as appendFileLog } from './logs/store.js'
import { verifyToken } from '@clerk/express'

export function initWebSocket(server: Server, path: string = '/ws') {
    const wss = new WebSocketServer({ server, path })

    wss.on('connection', async (ws, req) => {
        // Extract token from query string: /ws?token=xxx
        const url = new URL(req.url || '', `http://${req.headers.host}`)
        const token = url.searchParams.get('token')

        if (!token) {
            ws.close(4001, 'Missing auth token')
            return
        }

        try {
            await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY })
        } catch {
            ws.close(4003, 'Invalid auth token')
            return
        }

        clients.add(ws)
        console.log('[WS] Client connected (authenticated)')

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
            profileName: (data as any).profileName,
            workflowId: (data as any).workflowId,
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
        logsStore.push(logEntry)
        if (logsStore.length > MAX_LOGS) {
            logsStore.shift()
        }
        appendFileLog(logEntry.message, logEntry.source, logEntry.level as any, logEntry.profileName, {
            workflowId: logEntry.workflowId,
            taskId: logEntry.taskId,
            targetUsername: logEntry.targetUsername,
            errorCode: logEntry.errorCode,
            outcome: logEntry.outcome,
            diagnostics: logEntry.diagnostics,
            attempt: logEntry.attempt,
        })
    }

    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message)
        }
    })
}
