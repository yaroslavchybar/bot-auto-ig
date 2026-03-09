import { ProfilesPage } from '@/features/profiles/ProfilesPage'
import { RouteErrorView } from '@/components/shared/RouteErrorView'

export const handle = {
  navId: 'profiles',
  breadcrumb: 'Profiles Manager',
}

export default function ProfilesRoute() {
  return <ProfilesPage />
}

export function ErrorBoundary() {
  return <RouteErrorView title="Profiles Error" />
}
