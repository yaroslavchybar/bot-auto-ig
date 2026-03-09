import { ProtectedLayoutShell } from '@/components/layout/ProtectedLayoutShell'
import { RouteErrorView } from '@/components/shared/RouteErrorView'

export default function ProtectedLayoutRoute() {
  return <ProtectedLayoutShell />
}

export function ErrorBoundary() {
  return <RouteErrorView title="Dashboard Error" />
}
