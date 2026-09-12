import { useAppAuth } from '@/lib/auth'
import { Navigate } from 'react-router'
import { RefreshCw } from 'lucide-react'
import { AUTH_ROUTES } from '@/lib/auth-routing'

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
    return <Navigate to={AUTH_ROUTES.login} replace />
  }

  return <>{children}</>
}
