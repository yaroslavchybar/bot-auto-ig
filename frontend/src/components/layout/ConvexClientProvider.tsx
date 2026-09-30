import { ConvexProvider, ConvexReactClient } from 'convex/react'
import { useSyncExternalStore, type ReactNode } from 'react'
import { env } from '@/lib/env'

let client: ConvexReactClient | null = null
const listeners = new Set<() => void>()
const getClient = () => client
function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!client) {
    client = new ConvexReactClient(env.convexUrl)
    listeners.forEach((notify) => notify())
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && client) {
      void client.close()
      client = null
    }
  }
}

// Convex reads are server-gated at the Express layer; the browser client
// carries no identity. Admin-only access is enforced by the session login.
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const convex = useSyncExternalStore(subscribe, getClient, () => null)
  return convex ? <ConvexProvider client={convex}>{children}</ConvexProvider> : null
}
