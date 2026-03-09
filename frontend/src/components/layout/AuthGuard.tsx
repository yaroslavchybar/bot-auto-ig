import { useAuth } from '@clerk/clerk-react'
import { Navigate } from 'react-router'
import { RefreshCw } from 'lucide-react'

interface AuthGuardProps {
  children: React.ReactNode
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { isLoaded, isSignedIn } = useAuth()

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
    return <Navigate to="/sign-in" replace />
  }

  return <>{children}</>
}


