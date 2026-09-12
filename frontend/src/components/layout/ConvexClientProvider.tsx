import { ConvexProviderWithAuth, ConvexReactClient } from 'convex/react'
import type { ReactNode } from 'react'
import { env } from '@/lib/env'
import { useAppAuth } from '@/lib/auth'

const convex = new ConvexReactClient(env.convexUrl)

function useConvexAuth() {
  const { isLoaded, isSignedIn, getToken } = useAppAuth()

  return {
    isLoading: !isLoaded,
    isAuthenticated: isSignedIn,
    fetchAccessToken: ({ forceRefresh }: { forceRefresh: boolean }) =>
      getToken({ template: 'convex', skipCache: forceRefresh }),
  }
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexProviderWithAuth client={convex} useAuth={useConvexAuth}>
      {children}
    </ConvexProviderWithAuth>
  )
}


