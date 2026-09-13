import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { env } from '@/lib/env'
import { setTokenGetter } from '@/lib/api'

export type AppAuthTokenOptions = {
  template?: string
  skipCache?: boolean
}

export type AppUser = {
  id: string
  firstName: string
  lastName: string
  fullName: string
  username: string
  photoUrl: string
}

export type AuthConfig = {
  botUsername: string
  isConfigured: boolean
  isDevLoginEnabled: boolean
}

type AppAuthContextValue = {
  isLoaded: boolean
  isSignedIn: boolean
  getToken: (options?: AppAuthTokenOptions) => Promise<string | null>
  user: AppUser | null
  authFetch: (path: string, init?: RequestInit) => Promise<Response>
  loginWithToken: (user: AppUser, token: string) => void
  devLogin: () => Promise<void>
  signOut: () => Promise<void>
}

const SESSION_STORAGE_KEY = 'tg_session'

const LOCAL_USER: AppUser = {
  id: 'local-dev-user',
  firstName: 'Local',
  lastName: 'Developer',
  fullName: 'Local Developer',
  username: 'local-dev',
  photoUrl: '',
}

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY)
  } catch {
    return null
  }
}

function authUrl(path: string): string {
  return new URL(path, `${env.apiUrl}/`).toString()
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown }
    if (typeof data?.error === 'string' && data.error) return data.error
  } catch {
    // Fall through to status-based message.
  }
  return `${fallback} (HTTP ${res.status})`
}

const AppAuthContext = createContext<AppAuthContextValue | null>(null)

function LocalAuthProvider({ children }: { children: ReactNode }) {
  const value: AppAuthContextValue = {
    isLoaded: true,
    isSignedIn: true,
    getToken: async () => null,
    user: LOCAL_USER,
    authFetch: (path, init) => fetch(authUrl(path), init),
    loginWithToken: () => undefined,
    devLogin: async () => undefined,
    signOut: async () => undefined,
  }

  return <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>
}

function TelegramAuthProvider({ children }: { children: ReactNode }) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [user, setUser] = useState<AppUser | null>(null)
  // In-memory session token: keeps the session alive when localStorage
  // persistence is unavailable. Storage is persistence only.
  const tokenRef = useRef<string | null>(null)

  const currentToken = useCallback(
    () => tokenRef.current ?? readStoredToken(),
    [],
  )

  const storeSession = useCallback((nextToken: string, nextUser: AppUser) => {
    tokenRef.current = nextToken
    setUser(nextUser)
    try {
      window.localStorage.setItem(SESSION_STORAGE_KEY, nextToken)
    } catch {
      // Session survives in memory for this tab.
    }
  }, [])

  const clearSession = useCallback(() => {
    tokenRef.current = null
    setUser(null)
    try {
      window.localStorage.removeItem(SESSION_STORAGE_KEY)
    } catch {
      // Already cleared or storage unavailable.
    }
  }, [])

  const authFetch = useCallback(
    (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      const current = tokenRef.current ?? readStoredToken()
      if (current && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${current}`)
      }
      return fetch(authUrl(path), { ...init, headers, credentials: 'include' })
    },
    [],
  )

  // Revalidate any stored session on mount. The token being validated is
  // captured up front so a stale response can never overwrite a newer
  // session established by loginWithToken or devLogin meanwhile.
  useEffect(() => {
    let cancelled = false
    const validating = tokenRef.current ?? readStoredToken()
    const isStale = () =>
      cancelled || (tokenRef.current ?? readStoredToken()) !== validating
    ;(async () => {
      try {
        const res = await authFetch('/api/auth/me')
        const data = (await res.json().catch(() => null)) as {
          authenticated?: boolean
          user?: AppUser
        } | null
        if (isStale()) return
        if (res.ok && data?.authenticated && data.user) {
          setUser(data.user)
        } else {
          clearSession()
        }
      } catch {
        if (!isStale()) clearSession()
      } finally {
        if (!cancelled) setIsLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authFetch, clearSession])

  const devLogin = useCallback(async () => {
    const res = await authFetch('/api/auth/dev-login', { method: 'POST' })
    if (!res.ok) throw new Error(await readErrorMessage(res, 'Dev login failed'))
    const data = (await res.json()) as { user: AppUser; token: string }
    storeSession(data.token, data.user)
  }, [authFetch, storeSession])

  // Deep-link login: the tg-poll endpoint returns the session directly.
  const loginWithToken = useCallback(
    (user: AppUser, token: string) => {
      storeSession(token, user)
    },
    [storeSession],
  )

  const signOut = useCallback(async () => {
    try {
      await authFetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // Session is cleared locally regardless.
    }
    clearSession()
  }, [authFetch, clearSession])

  const getToken = useCallback(async () => currentToken(), [currentToken])

  useEffect(() => {
    setTokenGetter(getToken)
    return () => setTokenGetter(async () => null)
  }, [getToken])

  const value: AppAuthContextValue = {
    isLoaded,
    isSignedIn: user !== null,
    getToken,
    user,
    authFetch,
    loginWithToken,
    devLogin,
    signOut,
  }

  return <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>
}

export function AppAuthProvider({ children }: { children: ReactNode }) {
  if (env.disableAuth) {
    return <LocalAuthProvider>{children}</LocalAuthProvider>
  }

  return <TelegramAuthProvider>{children}</TelegramAuthProvider>
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
