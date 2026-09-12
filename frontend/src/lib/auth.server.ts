import { getAuth } from '@clerk/react-router/server'
import type { LoaderFunctionArgs } from 'react-router'
import { redirect } from 'react-router'
import { AUTH_ROUTES, buildSignInRedirect } from '@/lib/auth-routing'
import { env } from '@/lib/env'

export async function requireSignedIn(args: LoaderFunctionArgs) {
  if (env.disableClerkAuth) {
    return { userId: 'local-dev-user' }
  }

  const { userId } = await getAuth(args)

  if (!userId) {
    return buildSignInRedirect(args.request.url)
  }

  return { userId }
}

export async function redirectSignedInUser(args: LoaderFunctionArgs) {
  if (env.disableClerkAuth) {
    throw redirect(AUTH_ROUTES.signedInFallback)
  }

  const { userId } = await getAuth(args)

  if (userId) {
    throw redirect(AUTH_ROUTES.signedInFallback)
  }

  return null
}
