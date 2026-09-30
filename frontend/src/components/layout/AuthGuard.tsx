import { useAppAuth } from '@/lib/auth'
import { Navigate } from '@/lib/router'
import { AUTH_ROUTES, REDIRECT_URL_PARAM } from '@/lib/auth-routing'

interface AuthGuardProps {
  children: React.ReactNode
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { isLoaded, isSignedIn } = useAppAuth()

  if (!isLoaded) return null

  if (!isSignedIn) {
    const next = `${window.location.pathname}${window.location.search}`
    const params = new URLSearchParams({ [REDIRECT_URL_PARAM]: next })
    return <Navigate to={`${AUTH_ROUTES.login}?${params.toString()}`} replace />
  }

  return <>{children}</>
}
