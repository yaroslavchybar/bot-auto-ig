import { SignInPage } from '@/pages/SignInPage'
import { RouteErrorView } from '@/components/shared/RouteErrorView'

export const handle = {
  breadcrumb: 'Sign In',
}

export default function SignInRoute() {
  return <SignInPage />
}

export function ErrorBoundary() {
  return <RouteErrorView title="Sign-In Error" />
}
