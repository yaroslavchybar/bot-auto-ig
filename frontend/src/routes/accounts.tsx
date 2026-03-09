import { AccountsPage } from '@/features/accounts/AccountsPage'
import { RouteErrorView } from '@/components/shared/RouteErrorView'

export const handle = {
  navId: 'accounts',
  breadcrumb: 'Upload Accounts',
}

export default function AccountsRoute() {
  return <AccountsPage />
}

export function ErrorBoundary() {
  return <RouteErrorView title="Accounts Error" />
}
