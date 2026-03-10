import { VncSessionPage } from '@/features/vnc/VncSessionPage'
import { RouteErrorView } from '@/components/shared/RouteErrorView'

export const handle = {
  navId: 'vnc',
  breadcrumb: 'Live Session',
}

export default function VncSessionRoute() {
  return <VncSessionPage />
}

export function ErrorBoundary() {
  return <RouteErrorView title="Live Session Error" />
}
