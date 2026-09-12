import { useAppAuth } from '@/lib/auth'
import { Navigate } from '@/lib/router'
import { RefreshCw } from 'lucide-react'
import { AUTH_ROUTES, REDIRECT_URL_PARAM } from '@/lib/auth-routing'

interface AuthGuardProps {
  children: React.ReactNode
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { isLoaded, isSignedIn } = useAppAuth()

  if (!isLoaded) {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <div className="text-center">
          <RefreshCw className="text-muted-foreground mx-auto mb-2 h-8 w-8 animate-spin" />
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isSignedIn) {
    const next = `${window.location.pathname}${window.location.search}`
    const params = new URLSearchParams({ [REDIRECT_URL_PARAM]: next })
    return <Navigate to={`${AUTH_ROUTES.login}?${params.toString()}`} replace />
  }

  return <>{children}</>
}
