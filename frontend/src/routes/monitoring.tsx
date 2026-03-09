import { MonitoringPage } from '@/features/monitoring/MonitoringPage'
import { RouteErrorView } from '@/components/shared/RouteErrorView'

export const handle = {
  navId: 'monitoring',
  breadcrumb: 'VPS Monitor',
}

export default function MonitoringRoute() {
  return <MonitoringPage />
}

export function ErrorBoundary() {
  return <RouteErrorView title="Monitoring Error" />
}
