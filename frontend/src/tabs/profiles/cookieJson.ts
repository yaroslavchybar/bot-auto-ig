type CookieShape = {
  name: string
  value: string
  domain?: string
  path?: string
  url?: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractCookieList(input: unknown): unknown[] {
  if (Array.isArray(input)) return input
  if (!isRecord(input))
    throw new Error('Cookies JSON must be an array or an object with cookies')
  if (Array.isArray(input.cookies)) return input.cookies
  if (Array.isArray(input.cookie)) return input.cookie
  if (isRecord(input.data) && Array.isArray(input.data.cookies))
    return input.data.cookies
  throw new Error('Cookies JSON must be an array or include a cookies array')
}

function normalizeCookie(cookie: unknown, index: number): CookieShape {
  if (!isRecord(cookie)) {
    throw new Error(`Cookie at index ${index} must be an object`)
  }

  const name = String(cookie.name ?? '').trim()
  const value = String(cookie.value ?? '').trim()
  if (!name) throw new Error(`Cookie at index ${index} is missing name`)
  if (!value) throw new Error(`Cookie at index ${index} is missing value`)

  const url = String(cookie.url ?? '').trim()
  const domain = String(cookie.domain ?? '').trim()
  if (!url && !domain) {
    throw new Error(`Cookie "${name}" must include domain or url`)
  }

  const normalized: CookieShape = {
    name,
    value,
  }

  if (url) {
    normalized.url = url
  } else {
    normalized.domain = domain
    normalized.path = String(cookie.path ?? '/').trim() || '/'
  }

  const expiresRaw =
    cookie.expires ?? cookie.expirationDate ?? cookie.expire_time
  const expiresText = String(expiresRaw ?? '').trim()
  const expires =
    typeof expiresRaw === 'number'
      ? expiresRaw
      : expiresText
        ? Number(expiresText)
        : NaN
  if (Number.isFinite(expires)) normalized.expires = expires

  if (typeof cookie.httpOnly === 'boolean')
    normalized.httpOnly = cookie.httpOnly
  if (typeof cookie.secure === 'boolean') normalized.secure = cookie.secure

  const sameSite = String(cookie.sameSite ?? cookie.same_site ?? '')
    .trim()
    .toLowerCase()
  if (sameSite === 'strict') normalized.sameSite = 'Strict'
  if (sameSite === 'lax') normalized.sameSite = 'Lax'
  if (
    sameSite === 'none' ||
    sameSite === 'no_restriction' ||
    sameSite === 'unspecified'
  )
    normalized.sameSite = 'None'

  return normalized
}

export function normalizeCookiesJsonForForm(raw: string): {
  normalized?: string
  error?: string
} {
  const trimmed = raw.trim()
  if (!trimmed) return { normalized: '' }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { error: `Cookies JSON must be valid JSON: ${message}` }
  }

  try {
    const normalized = extractCookieList(parsed).map((cookie, index) =>
      normalizeCookie(cookie, index),
    )
    if (normalized.length === 0) {
      return { error: 'Cookies JSON must include at least one cookie' }
    }
    return { normalized: JSON.stringify(normalized, null, 2) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}
