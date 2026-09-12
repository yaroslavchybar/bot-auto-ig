import { ConvexProvider, ConvexReactClient } from 'convex/react'
import type { ReactNode } from 'react'
import { env } from '@/lib/env'

const convex = new ConvexReactClient(env.convexUrl)

// Convex reads are server-gated at the Express layer; the browser client
// carries no identity. Admin-only access is enforced by the session login.
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexProvider client={convex}>{children}</ConvexProvider>
}
