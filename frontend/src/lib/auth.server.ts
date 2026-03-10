import { getAuth } from '@clerk/react-router/server'
import type { LoaderFunctionArgs } from 'react-router'
import { redirect } from 'react-router'
import { AUTH_ROUTES, buildSignInRedirect } from '@/lib/auth-routing'

export async function requireSignedIn(args: LoaderFunctionArgs) {
  const { userId } = await getAuth(args)

  if (!userId) {
    buildSignInRedirect(args.request.url)
  }

  return { userId }
}

export async function redirectSignedInUser(args: LoaderFunctionArgs) {
  const { userId } = await getAuth(args)

  if (userId) {
    throw redirect(AUTH_ROUTES.signedInFallback)
  }

  return null
}
