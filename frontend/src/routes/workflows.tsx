import { WorkflowsPage } from '@/features/workflows/WorkflowsPage'
import { RouteErrorView } from '@/components/shared/RouteErrorView'

export const handle = {
  navId: 'workflows',
  breadcrumb: 'Workflows',
}

export default function WorkflowsRoute() {
  return <WorkflowsPage />
}

export function ErrorBoundary() {
  return <RouteErrorView title="Workflows Error" />
}
