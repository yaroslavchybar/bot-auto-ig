import { getAuth } from '@clerk/react-router/server'
import type { Route } from './+types/index'
import { redirect } from 'react-router'
import { AUTH_ROUTES } from '@/lib/auth-routing'
import { env } from '@/lib/env'

export async function loader(args: Route.LoaderArgs) {
  if (env.disableClerkAuth) {
    throw redirect(AUTH_ROUTES.signedInFallback)
  }

  const { userId } = await getAuth(args)
  throw redirect(userId ? AUTH_ROUTES.signedInFallback : AUTH_ROUTES.signIn)
}

export default function IndexRoute() {
  return null
}
