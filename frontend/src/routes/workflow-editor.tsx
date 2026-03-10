import { WorkflowEditorPage } from '@/features/workflows/WorkflowEditorPage'
import { RouteErrorView } from '@/components/shared/RouteErrorView'

export const handle = {
  navId: 'workflows',
  breadcrumb: 'Workflow Editor',
  appChrome: 'immersive',
}

export default function WorkflowEditorRoute() {
  return <WorkflowEditorPage />
}

export function ErrorBoundary() {
  return <RouteErrorView title="Workflow Editor Error" />
}
