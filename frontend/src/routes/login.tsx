import { LoginPage } from '@/pages/LoginPage'
import { RouteErrorView } from '@/components/shared/RouteErrorView'

export const handle = {
  breadcrumb: 'Sign In',
}

export default function LoginRoute() {
  return <LoginPage />
}

export function ErrorBoundary() {
  return <RouteErrorView title="Sign-In Error" />
}
