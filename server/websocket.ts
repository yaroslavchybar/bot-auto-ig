import { WebSocketServer, WebSocket } from 'ws'
import { Server } from 'http'
import { clients } from './shared/store.js'
import { isWorkerAuthorized } from './worker/server.js'
import { LogScope } from './shared/logger.js'
import { matchesSubscription, parseSubscription } from './shared/subscriptions.js'

export function initWebSocket(server: Server, path: string = '/events') {
  const wss = new WebSocketServer({ server, path })

  wss.on('connection', async (ws, req) => {
    const scope = new LogScope('worker.events', { path })
    ws.once('close', (code) => {
      clients.delete(ws)
      scope.add({ closeCode: code })
      scope.finish()
    })
    ws.on('error', (error) => {
      scope.add({ error, outcome: 'error' })
    })
    const url = new URL(req.url || '', `http://${req.headers.host}`)
    if (!isWorkerAuthorized(req)) {
      scope.add({ outcome: 'rejected', reason: 'invalid_worker_key' })
      ws.close(4003, 'Invalid worker key')
      return
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
  client.send(message, (error) => {
    if (error) {
      clients.delete(client)
      client.terminate()
    }
  })
}
