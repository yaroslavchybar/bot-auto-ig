import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** Each connected socket owns a slot until it closes, including worker crashes. */
export function createBrowserBudget(endpoint: string, limit: number) {
  const waiting = new Set<net.Socket>()
  const active = new Set<net.Socket>()
  const drain = () => {
    for (const socket of waiting) {
      if (active.size >= limit) break
      waiting.delete(socket)
      if (socket.destroyed) continue
      active.add(socket)
      socket.write('ready\n')
    }
  }
  const server = net.createServer(socket => {
    socket.unref()
    waiting.add(socket)
    socket.on('error', () => socket.destroy())
    socket.once('close', () => { waiting.delete(socket); active.delete(socket); drain() })
    drain()
  })
  server.listen(endpoint)
  server.unref()
  return server
}

let endpoint: string | undefined
export function browserBudgetEndpoint(): string {
  if (endpoint) return endpoint
  const name = `ig-bot-${process.pid}-${randomUUID()}`
  endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : path.join(os.tmpdir(), `${name}.sock`)
  const configured = Number(process.env.BROWSER_MAX_CONCURRENCY ?? 3)
  const limit = Number.isFinite(configured) ? Math.max(1, Math.floor(configured)) : 3
  createBrowserBudget(endpoint, limit).on('error', error => {
    // Do not silently run without the resource limit.
    process.stderr.write(`Browser budget failed: ${error.message}\n`)
  })
  return endpoint
}

export function acquireBrowserSlot(signal: AbortSignal, address = process.env.BROWSER_BUDGET_ENDPOINT,
  onLost: () => void = () => {}): Promise<() => void> {
  if (!address) throw new Error('Browser sessions must be started through the server resource budget')
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const socket = net.connect(address)
    let granted = false
    let released = false
    const release = () => { released = true; signal.removeEventListener('abort', abort); socket.destroy() }
    const abort = () => { release(); reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    socket.once('data', () => { granted = true; signal.removeEventListener('abort', abort); resolve(release) })
    socket.once('error', error => { socket.destroy(); reject(error) })
    socket.once('close', () => {
      signal.removeEventListener('abort', abort)
      if (!granted) reject(new Error('Browser budget disconnected before granting a slot'))
      else if (!released) onLost()
    })
  })
}
