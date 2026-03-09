import { LogsPage } from '@/features/logs/LogsPage'
import { RouteErrorView } from '@/components/shared/RouteErrorView'

export const handle = {
  navId: 'logs',
  breadcrumb: 'Logs',
}

export default function LogsRoute() {
  return <LogsPage />
}

export function ErrorBoundary() {
  return <RouteErrorView title="Logs Error" />
}
