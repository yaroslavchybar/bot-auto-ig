import type { Route } from './+types/protected-layout'
import { ProtectedLayoutShell } from '@/components/layout/ProtectedLayoutShell'
import { RouteErrorView } from '@/components/shared/RouteErrorView'
import { parseSidebarOpen } from '@/lib/sidebar-state'

export async function loader(args: Route.LoaderArgs) {
  return {
    sidebarDefaultOpen: parseSidebarOpen(args.request.headers.get('cookie')),
  }
}

export default function ProtectedLayoutRoute({
  loaderData,
}: Route.ComponentProps) {
  return (
    <ProtectedLayoutShell
      sidebarDefaultOpen={loaderData.sidebarDefaultOpen}
    />
  )
}

export function ErrorBoundary() {
  return <RouteErrorView title="Dashboard Error" />
}
