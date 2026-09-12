import { redirect } from 'react-router'

export const AUTH_ROUTES = {
  login: '/login',
  signedInFallback: '/profiles',
} as const

export const REDIRECT_URL_PARAM = 'redirect_url'

export function buildLoginRedirect(requestUrl: string): never {
  const loginUrl = new URL(AUTH_ROUTES.login, requestUrl)
  loginUrl.searchParams.set(REDIRECT_URL_PARAM, requestUrl)
  throw redirect(`${loginUrl.pathname}${loginUrl.search}`)
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
