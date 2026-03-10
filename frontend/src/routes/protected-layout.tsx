import type { Route } from './+types/protected-layout'
import { ProtectedLayoutShell } from '@/components/layout/ProtectedLayoutShell'
import { RouteErrorView } from '@/components/shared/RouteErrorView'
import { requireSignedIn } from '@/lib/auth.server'

export function loader(args: Route.LoaderArgs) {
  return requireSignedIn(args)
}

export default function ProtectedLayoutRoute() {
  return <ProtectedLayoutShell />
}

export function ErrorBoundary() {
  return <RouteErrorView title="Dashboard Error" />
}
