import {
  ClerkProvider,
  useAuth as useClerkAuth,
  useClerk as useClerkClient,
  useUser as useClerkUser,
} from '@clerk/react-router'
import { createContext, useContext, type ReactNode } from 'react'
import type { Appearance } from '@clerk/types'
import { env } from '@/lib/env'

export type AppAuthTokenOptions = {
  template?: string
  skipCache?: boolean
}

export type AppUser = {
  id: string
  firstName: string | null
  lastName: string | null
  fullName: string | null
  imageUrl: string
  primaryEmailAddress: { emailAddress: string } | null
}

type AppAuthContextValue = {
  isLoaded: boolean
  isSignedIn: boolean
  getToken: (options?: AppAuthTokenOptions) => Promise<string | null>
  user: AppUser | null
  openUserProfile: () => void
  signOut: (options?: { redirectUrl?: string }) => Promise<void>
}

const LOCAL_USER: AppUser = {
  id: 'local-dev-user',
  firstName: 'Local',
  lastName: 'Developer',
  fullName: 'Local Developer',
  imageUrl: '',
  primaryEmailAddress: { emailAddress: 'local-dev@example.test' },
}

const AppAuthContext = createContext<AppAuthContextValue | null>(null)

function LocalAuthProvider({ children }: { children: ReactNode }) {
  const value: AppAuthContextValue = {
    isLoaded: true,
    isSignedIn: true,
    getToken: async () => null,
    user: LOCAL_USER,
    openUserProfile: () => undefined,
    signOut: async () => undefined,
  }

  return <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>
}

function ClerkAuthBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useClerkAuth()
  const { user } = useClerkUser()
  const clerk = useClerkClient()

  const appUser: AppUser | null = user
    ? {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        imageUrl: user.imageUrl,
        primaryEmailAddress: user.primaryEmailAddress
          ? { emailAddress: user.primaryEmailAddress.emailAddress }
          : null,
      }
    : null

  const value: AppAuthContextValue = {
    isLoaded,
    isSignedIn: Boolean(isSignedIn),
    getToken: (options) => getToken(options),
    user: appUser,
    openUserProfile: () => clerk.openUserProfile(),
    signOut: (options) => clerk.signOut(options),
  }

  return <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>
}

type AppAuthProviderProps = {
  children: ReactNode
  loaderData: unknown
  appearance: Appearance
}

export function AppAuthProvider({
  children,
  loaderData,
  appearance,
}: AppAuthProviderProps) {
  if (env.disableClerkAuth) {
    return <LocalAuthProvider>{children}</LocalAuthProvider>
  }

  return (
    <ClerkProvider
      loaderData={loaderData}
      publishableKey={env.clerkPublishableKey}
      appearance={appearance}
    >
      <ClerkAuthBridge>{children}</ClerkAuthBridge>
    </ClerkProvider>
  )
}

export function useAppAuth() {
  const context = useContext(AppAuthContext)
  if (!context) {
    throw new Error('useAppAuth must be used inside AppAuthProvider')
  }
  return context
}

export function useAppUser() {
  return useAppAuth().user
}

export function useAppClerk() {
  const { openUserProfile, signOut } = useAppAuth()
  return { openUserProfile, signOut }
}
