import type { Route } from './+types/protected-layout'
import { ProtectedLayoutShell } from '@/components/layout/ProtectedLayoutShell'
import { RouteErrorView } from '@/components/shared/RouteErrorView'
import { requireSignedIn } from '@/lib/auth.server'
import { parseSidebarOpen } from '@/lib/sidebar-state'

export async function loader(args: Route.LoaderArgs) {
  const auth = await requireSignedIn(args)

  return {
    ...auth,
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
