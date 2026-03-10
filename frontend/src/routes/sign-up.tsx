import type { Route } from './+types/sign-up'
import { SignUpPage } from '@/pages/SignUpPage'
import { RouteErrorView } from '@/components/shared/RouteErrorView'
import { redirectSignedInUser } from '@/lib/auth.server'

export const handle = {
  breadcrumb: 'Sign Up',
}

export function loader(args: Route.LoaderArgs) {
  return redirectSignedInUser(args)
}

export default function SignUpRoute() {
  return <SignUpPage />
}

export function ErrorBoundary() {
  return <RouteErrorView title="Sign-Up Error" />
}
