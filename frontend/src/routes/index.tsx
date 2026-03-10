import { getAuth } from '@clerk/react-router/server'
import type { Route } from './+types/index'
import { redirect } from 'react-router'
import { AUTH_ROUTES } from '@/lib/auth-routing'

export async function loader(args: Route.LoaderArgs) {
  const { userId } = await getAuth(args)
  throw redirect(userId ? AUTH_ROUTES.signedInFallback : AUTH_ROUTES.signIn)
}

export default function IndexRoute() {
  return null
}
