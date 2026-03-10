import type { Route } from './+types/sign-in'
import { SignInPage } from '@/pages/SignInPage'
import { RouteErrorView } from '@/components/shared/RouteErrorView'
import { redirectSignedInUser } from '@/lib/auth.server'

export const handle = {
  breadcrumb: 'Sign In',
}

export function loader(args: Route.LoaderArgs) {
  return redirectSignedInUser(args)
}

export default function SignInRoute() {
  return <SignInPage />
}

export function ErrorBoundary() {
  return <RouteErrorView title="Sign-In Error" />
}
