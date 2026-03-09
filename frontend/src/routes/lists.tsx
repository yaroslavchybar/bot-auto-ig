import { ListsPage } from '@/features/lists/ListsPage'
import { RouteErrorView } from '@/components/shared/RouteErrorView'

export const handle = {
  navId: 'lists',
  breadcrumb: 'Lists Manager',
}

export default function ListsRoute() {
  return <ListsPage />
}

export function ErrorBoundary() {
  return <RouteErrorView title="Lists Error" />
}
