import { SignUpPage } from '@/pages/SignUpPage'
import { RouteErrorView } from '@/components/shared/RouteErrorView'

export const handle = {
  breadcrumb: 'Sign Up',
}

export default function SignUpRoute() {
  return <SignUpPage />
}

export function ErrorBoundary() {
  return <RouteErrorView title="Sign-Up Error" />
}
