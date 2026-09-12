import { redirect } from 'react-router'
import { AUTH_ROUTES } from '@/lib/auth-routing'

export function loader() {
  throw redirect(AUTH_ROUTES.signedInFallback)
}

export default function IndexRoute() {
  return null
}
