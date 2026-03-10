export const SIDEBAR_COOKIE_NAME = 'sidebar_state'
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7

export function parseSidebarOpen(
  cookieHeader: string | null | undefined,
  fallback = true,
) {
  if (!cookieHeader) {
    return fallback
  }

  const cookies = cookieHeader.split(';')

  for (const cookie of cookies) {
    const [rawName, ...rawValueParts] = cookie.trim().split('=')

    if (rawName !== SIDEBAR_COOKIE_NAME) {
      continue
    }

    const rawValue = rawValueParts.join('=').trim()

    if (rawValue === 'true') {
      return true
    }

    if (rawValue === 'false') {
      return false
    }

    return fallback
  }

  return fallback
}

export function buildSidebarCookie(open: boolean) {
  return `${SIDEBAR_COOKIE_NAME}=${open}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
}
