import { VncPage } from '@/features/vnc/VncPage'
import { RouteErrorView } from '@/components/shared/RouteErrorView'

export const handle = {
  navId: 'vnc',
  breadcrumb: 'Browser View',
}

export default function VncRoute() {
  return <VncPage />
}

export function ErrorBoundary() {
  return <RouteErrorView title="VNC Error" />
}
