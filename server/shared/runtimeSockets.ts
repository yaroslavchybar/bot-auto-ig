import WebSocket from 'ws'
import { runtimeHeaders, runtimeUrl } from './runtime.js'

/** A live socket owns a Rust resource. Closing it releases the resource after a crash too. */
export function nativeLease<T>(
  route: string,
  args: object | undefined,
  signal: AbortSignal,
  onLost: () => void,
  acknowledgeRelease = false,
): Promise<{ value: T; release: () => Promise<void> }> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(runtimeUrl().replace(/^http/, 'ws') + route, {
      headers: runtimeHeaders(),
      maxPayload: 4096,
      handshakeTimeout: 5_000,
    })
    let granted = false
    let released = false
    let releasing: Promise<void> | undefined
    let confirmRelease: (() => void) | undefined
    let failRelease: ((error: Error) => void) | undefined
    const release = () => {
      if (releasing) return releasing
      released = true
      signal.removeEventListener('abort', abort)
      if (!acknowledgeRelease) {
        socket.terminate()
        return releasing = Promise.resolve()
      }
      releasing = new Promise<void>((resolveRelease, rejectRelease) => {
        confirmRelease = resolveRelease
        failRelease = rejectRelease
        if (socket.readyState !== WebSocket.OPEN) {
          rejectRelease(new Error('Rust disconnected before releasing the resource'))
        } else socket.send(JSON.stringify({ release: true }), error => {
          if (error) {
            rejectRelease(error)
            socket.terminate()
          }
        })
      })
      return releasing
    }
    const abort = () => {
      released = true
      socket.terminate()
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
    socket.on('open', () => {
      if (args) socket.send(JSON.stringify(args))
    })
    socket.on('message', (data) => {
      try {
        const value = JSON.parse(data.toString())
        if (granted) {
          if (released && value.released === true) {
            if (value.error) failRelease?.(new Error(value.error))
            else confirmRelease?.()
            socket.close()
          }
          return
        }
        if (value.ready !== true) throw new Error(value.error || 'Rust resource unavailable')
        granted = true
        signal.removeEventListener('abort', abort)
        resolve({ value: value as T, release })
      } catch (error) {
        released = true
        if (granted) failRelease?.(error instanceof Error ? error : new Error(String(error)))
        socket.terminate()
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
      failRelease?.(new Error('Rust disconnected before acknowledging resource release'))
    })
  })
}
