/** Default domain for cookies pasted without one. This app only
 * automates Instagram, and Playwright requires a url or domain+path
 * to set a cookie - so domain-less input gets .instagram.com. The
 * normalized result shown in the form always makes this explicit. */
const DEFAULT_COOKIE_DOMAIN = '.instagram.com'

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
  // A single cookie object, e.g. {"name":"sessionid",...}
  if (typeof input.name === 'string') return [input]
  throw new Error('Cookies JSON must be an array or include a cookies array')
}

/**
 * Parses Netscape cookies.txt format (tab-separated lines as exported by
 * "Get cookies.txt" style extensions and curl):
 *   [#HttpOnly_]domain \t subdomains \t path \t secure \t expires \t name \t value
 * Returns null when the text is not in this format.
 */
function parseNetscapeCookies(text: string): unknown[] | null {
  if (!text.includes('\t')) return null
  const list: unknown[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let httpOnly = false
    let body = trimmed
    if (body.startsWith('#HttpOnly_')) {
      httpOnly = true
      body = body.slice('#HttpOnly_'.length)
    } else if (body.startsWith('#')) {
      continue
    }
    const fields = body.split('\t')
    if (fields.length < 6 || !fields[5]?.trim()) return null
    const expires = Number(fields[4])
    list.push({
      domain: fields[0]?.trim(),
      path: fields[2]?.trim() || '/',
      secure: fields[3]?.trim().toUpperCase() === 'TRUE',
      ...(Number.isFinite(expires) && expires > 0 ? { expires } : {}),
      name: fields[5]?.trim(),
      value: (fields[6] ?? '').trim(),
      ...(httpOnly ? { httpOnly: true } : {}),
    })
  }
  return list.length > 0 ? list : null
}

const COOKIE_PAIR_NAME_PATTERN = /^[^\s;,\\"/]+$/

/**
 * Parses document.cookie style strings ("sessionid=abc; csrftoken=def").
 * Values may contain "=" (split on the first one only). Returns null when
 * the text does not look like cookie pairs.
 */
function parseCookiePairs(text: string): unknown[] | null {
  if (!text.includes('=')) return null
  const list: unknown[] = []
  for (const part of text.split(';')) {
    const eq = part.indexOf('=')
    if (eq <= 0) return null
    const name = part.slice(0, eq).trim()
    if (!name || !COOKIE_PAIR_NAME_PATTERN.test(name)) return null
    // Keep the raw value byte-for-byte: cookie values are opaque
    // server-issued tokens (often percent-encoded). Decoding here would
    // corrupt them (e.g. %3A -> ":") and break the stored session.
    const value = part.slice(eq + 1).trim()
    list.push({ name, value })
  }
  return list.length > 0 ? list : null
}

function normalizeCookie(cookie: unknown, index: number): CookieShape {
  if (!isRecord(cookie)) {
    throw new Error(`Cookie at index ${index} must be an object`)
  }

  const name = String(cookie.name ?? '').trim()
  if (!name) throw new Error(`Cookie at index ${index} is missing name`)
  // Empty values are allowed: real browser exports include valueless
  // cookies, and one of them must not block saving the whole jar.
  const value = String(cookie.value ?? '').trim()

  const url = String(cookie.url ?? '').trim()
  const domain = String(cookie.domain ?? '').trim()

  const normalized: CookieShape = {
    name,
    value,
  }

  if (url) {
    normalized.url = url
  } else {
    normalized.domain = domain || DEFAULT_COOKIE_DOMAIN
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

const PARSE_HELP =
  'Paste cookies as a JSON array, Netscape cookies.txt, or name=value pairs'

export function normalizeCookiesJsonForForm(raw: string): {
  normalized?: string
  error?: string
} {
  const trimmed = raw.trim()
  if (!trimmed) return { normalized: '' }

  let list: unknown[]
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { error: `Cookies JSON must be valid JSON: ${message}` }
    }
    try {
      list = extractCookieList(parsed)
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  } else {
    const netscape = parseNetscapeCookies(trimmed)
    if (netscape) {
      list = netscape
    } else {
      const pairs = parseCookiePairs(trimmed)
      if (!pairs) return { error: PARSE_HELP }
      list = pairs
    }
  }

  try {
    const normalized = list.map((cookie, index) =>
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
