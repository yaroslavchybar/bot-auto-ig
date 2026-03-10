import { redirect } from 'react-router'

export const AUTH_ROUTES = {
  signIn: '/sign-in',
  signUp: '/sign-up',
  signedInFallback: '/profiles',
} as const

export const REDIRECT_URL_PARAM = 'redirect_url'

export function buildSignInRedirect(requestUrl: string) {
  const signInUrl = new URL(AUTH_ROUTES.signIn, requestUrl)
  signInUrl.searchParams.set(REDIRECT_URL_PARAM, requestUrl)
  throw redirect(`${signInUrl.pathname}${signInUrl.search}`)
}

export function getSafeRedirectTarget(
  redirectUrl: string | null | undefined,
  currentOrigin?: string,
) {
  if (!redirectUrl) {
    return AUTH_ROUTES.signedInFallback
  }

  try {
    if (redirectUrl.startsWith('/')) {
      return redirectUrl
    }

    if (!currentOrigin) {
      return AUTH_ROUTES.signedInFallback
    }

    const absolute = new URL(redirectUrl)
    if (absolute.origin !== currentOrigin) {
      return AUTH_ROUTES.signedInFallback
    }

    return `${absolute.pathname}${absolute.search}${absolute.hash}`
  } catch {
    return AUTH_ROUTES.signedInFallback
  }
}
