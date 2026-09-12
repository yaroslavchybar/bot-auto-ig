export const AUTH_ROUTES = {
  login: '/login',
  signedInFallback: '/profiles',
} as const

export const REDIRECT_URL_PARAM = 'redirect_url'

export function buildLoginUrl(next: string): string {
  const params = new URLSearchParams({ [REDIRECT_URL_PARAM]: next })
  return `${AUTH_ROUTES.login}?${params.toString()}`
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
