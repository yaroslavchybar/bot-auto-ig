import '../env.js'
import WebSocket from 'ws'
import { runtimeUrl, runtimeHeaders } from './runtime.js'

export type RuntimeWarmup = {
  profileId: string
  nextRunAt?: number
  date?: string
  todayMinutes?: number
  minutesUsedToday?: number
  activeRun?: boolean
}
export type RuntimeProgress = {
  profileId: string
  nextRunAt?: number
  paused?: boolean
  issue?: string
}
export type RuntimeSnapshot = {
  automation: Record<string, any>
  profiles: Array<Record<string, any>>
  warmups?: RuntimeWarmup[]
  progress?: RuntimeProgress[]
  truncated?: boolean
} | null
const subscriptions = new Set<() => void>()

/** Rust owns Convex connections; browser actions receive updates over local sockets. */
export function subscribeToConvexQuery<T>(
  name: string,
  args: Record<string, unknown>,
  onUpdate: (value: T) => void,
  onError: (error: Error) => void,
  signal?: AbortSignal,
): { initial: Promise<T>; unsubscribe: () => void } {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  let initialized = false
  let stopped = false
  let socket: WebSocket | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  const initial = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  const fail = (error: Error) => {
    if (stopped) return
    if (!initialized) {
      initialized = true
      reject(error)
    }
    onError(error)
  }
  const connect = () => {
    if (stopped) return
    const current = (socket = new WebSocket(
      runtimeUrl().replace(/^http/, 'ws') + '/subscriptions',
      { headers: runtimeHeaders(), maxPayload: 1024 * 1024, handshakeTimeout: 5_000 },
    ))
    current.on('open', () => { if (!stopped) current.send(JSON.stringify({ name, args })) })
    current.on('message', (data) => {
      if (stopped) return
      try {
        const message = JSON.parse(data.toString())
        if (message.error) {
          fail(new Error(String(message.error)))
          return
        }
        if (!Object.hasOwn(message, 'value')) return
        if (!initialized) {
          initialized = true
          resolve(message.value as T)
        }
        onUpdate(message.value as T)
      } catch {
        fail(new Error('Invalid subscription update'))
      }
    })
    current.on('error', () => fail(new Error('Rust subscription connection failed')))
    current.on('close', () => {
      if (stopped) return
      fail(new Error('Rust subscription connection closed'))
      retry = setTimeout(connect, 1000)
      retry.unref()
    })
  }
  const unsubscribe = () => {
    if (stopped) return
    stopped = true
    if (retry) clearTimeout(retry)
    signal?.removeEventListener('abort', unsubscribe)
    socket?.terminate()
    subscriptions.delete(unsubscribe)
    if (!initialized) {
      initialized = true
      reject(signal?.aborted ? signal.reason : new Error('Subscription cancelled'))
    }
  }
  subscriptions.add(unsubscribe)
  if (signal?.aborted) unsubscribe()
  else {
    signal?.addEventListener('abort', unsubscribe, { once: true })
    connect()
  }
  return { initial, unsubscribe }
}

export const watchRoutineRuntime = (
  id: string,
  modelIds: string[],
  update: (value: RuntimeSnapshot) => void,
  error: (error: Error) => void,
  signal?: AbortSignal,
) => subscribeToConvexQuery('automations/queries:runtimeSnapshot', { id, modelIds }, update, error, signal)
export const watchRoutineAccess = (
  automationId: string,
  profileId: string,
  update: (value: boolean) => void,
  error: (error: Error) => void,
  signal?: AbortSignal,
) => subscribeToConvexQuery('routines:access', { automationId, profileId }, update, error, signal)
export async function closeConvexRealtime(): Promise<void> {
  for (const close of subscriptions) close()
}

export const watchProfileAccess = (
  profileId: string,
  update: (value: boolean) => void,
  error: (error: Error) => void,
  signal?: AbortSignal,
) => subscribeToConvexQuery('profiles/queries:automationAccess', { profileId }, update, error, signal)
