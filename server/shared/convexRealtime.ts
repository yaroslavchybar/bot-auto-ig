import '../env.js'

import { ConvexClient } from 'convex/browser'
import { anyApi } from 'convex/server'

const convexUrl = (process.env.CONVEX_URL?.trim() || process.env.VITE_CONVEX_URL?.trim() || '')
  .replace('.convex.site', '.convex.cloud')
const bridgeToken = process.env.INTERNAL_API_KEY?.trim() || ''

type Unsubscribe = (() => void) & {
  unsubscribe?: () => void
}

export type RuntimeSnapshot = {
  automation: Record<string, any>
  profiles: Array<Record<string, any>>
  warmups?: Array<{ profileId: string; nextRunAt?: number }>
  progress?: Array<{ profileId: string; nextRunAt?: number }>
  truncated?: boolean
} | null

let client: ConvexClient | undefined

function getClient(): ConvexClient {
  if (!convexUrl) throw new Error('Convex config missing. Set CONVEX_URL.')
  if (!bridgeToken) throw new Error('Convex config missing. Set INTERNAL_API_KEY.')
  return client ??= new ConvexClient(convexUrl, { logger: false })
}

function dispose(unsubscribe: Unsubscribe): void {
  (unsubscribe as unknown as () => void)()
}

/** Subscribe to a public Convex query and expose its first value as a promise. */
export function subscribeToConvexQuery<T>(
  query: any,
  args: Record<string, unknown>,
  onUpdate: (value: T) => void,
  onError: (error: Error) => void,
): { initial: Promise<T>; unsubscribe: () => void } {
  let resolveInitial!: (value: T) => void
  let rejectInitial!: (error: Error) => void
  let initialized = false
  const initial = new Promise<T>((resolve, reject) => {
    resolveInitial = resolve
    rejectInitial = reject
  })

  const subscription = getClient().onUpdate(
    query,
    args,
    (value: T) => {
      if (!initialized) {
        initialized = true
        resolveInitial(value)
      }
      onUpdate(value)
    },
    (error: Error) => {
      if (!initialized) {
        initialized = true
        rejectInitial(error)
      }
      onError(error)
    },
  ) as Unsubscribe

  return {
    initial,
    unsubscribe: () => dispose(subscription),
  }
}

export function watchRoutineRuntime(
  automationId: string,
  listIds: string[],
  onUpdate: (value: RuntimeSnapshot) => void,
  onError: (error: Error) => void,
) {
  return subscribeToConvexQuery<RuntimeSnapshot>(
    anyApi.automations.queries.runtimeSnapshot,
    { bridgeToken, id: automationId, listIds },
    onUpdate,
    onError,
  )
}

export function watchRoutineAccess(
  automationId: string,
  profileId: string,
  onUpdate: (value: boolean) => void,
  onError: (error: Error) => void,
) {
  return subscribeToConvexQuery<boolean>(
    anyApi.routines.access,
    { bridgeToken, automationId, profileId },
    onUpdate,
    onError,
  )
}

export function watchActiveRoutines(
  onUpdate: (value: Array<Record<string, any>>) => void,
  onError: (error: Error) => void,
) {
  return subscribeToConvexQuery<Array<Record<string, any>>>(
    anyApi.automations.queries.listRoutinesForScheduler,
    { bridgeToken },
    onUpdate,
    onError,
  )
}

export async function closeConvexRealtime(): Promise<void> {
  if (!client) return
  const current = client
  client = undefined
  await current.close()
}
