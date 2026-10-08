import WebSocket from 'ws'
import { runtimeHeaders, runtimeUrl } from './runtime.js'

/** A live socket owns a Rust resource. Closing it releases the resource after a crash too. */
export function nativeLease<T>(
  route: string,
  args: object | undefined,
  signal: AbortSignal,
  onLost: () => void,
): Promise<{ value: T; release: () => void }> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(runtimeUrl().replace(/^http/, 'ws') + route, {
      headers: runtimeHeaders(),
      maxPayload: 4096,
    })
    let granted = false
    let released = false
    const release = () => {
      released = true
      signal.removeEventListener('abort', abort)
      socket.terminate()
    }
    const abort = () => {
      release()
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
    socket.on('open', () => {
      if (args) socket.send(JSON.stringify(args))
    })
    socket.once('message', (data) => {
      try {
        const value = JSON.parse(data.toString())
        if (value.ready !== true) throw new Error(value.error || 'Rust resource unavailable')
        granted = true
        signal.removeEventListener('abort', abort)
        resolve({ value: value as T, release })
      } catch (error) {
        release()
        reject(error)
      }
    })
    socket.on('error', () => {
      if (!granted) reject(new Error('Rust resource connection failed'))
    })
    socket.once('close', () => {
      signal.removeEventListener('abort', abort)
      if (!granted) reject(new Error('Rust disconnected before granting the resource'))
      else if (!released) onLost()
    })
  })
}
