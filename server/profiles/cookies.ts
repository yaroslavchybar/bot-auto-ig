type UnknownRecord = Record<string, unknown>

type NormalizedCookie = {
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

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeSameSite(value: unknown): 'Strict' | 'Lax' | 'None' | undefined {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return undefined
  if (raw === 'strict') return 'Strict'
  if (raw === 'lax') return 'Lax'
  if (raw === 'none' || raw === 'no_restriction' || raw === 'unspecified') return 'None'
  return undefined
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase()
    if (lowered === 'true' || lowered === '1') return true
    if (lowered === 'false' || lowered === '0') return false
  }
  return undefined
}

function normalizeExpires(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const asNumber = Number(trimmed)
    if (Number.isFinite(asNumber)) return asNumber
  }
  return undefined
}

function extractCookieList(input: unknown): unknown[] {
  if (Array.isArray(input)) return input
  if (!isRecord(input)) throw new Error('Cookies JSON must be an array or object')
  if (Array.isArray(input.cookies)) return input.cookies
  if (Array.isArray(input.cookie)) return input.cookie
  if (isRecord(input.data) && Array.isArray(input.data.cookies)) return input.data.cookies
  throw new Error('Cookies JSON must contain a cookies array')
}

function normalizeCookie(cookie: unknown, index: number): NormalizedCookie {
  if (!isRecord(cookie)) {
    throw new Error(`Cookie at index ${index} must be an object`)
  }

  const name = String(cookie.name ?? '').trim()
  const value = String(cookie.value ?? '').trim()
  if (!name) throw new Error(`Cookie at index ${index} is missing name`)
  if (!value) throw new Error(`Cookie at index ${index} is missing value`)

  const url = String(cookie.url ?? '').trim()
  const domain = String(cookie.domain ?? '').trim()
  const path = String(cookie.path ?? '/').trim() || '/'
  if (!url && !domain) {
    throw new Error(`Cookie "${name}" must include domain or url`)
  }

  const normalized: NormalizedCookie = {
    name,
    value,
  }

  if (url) {
    normalized.url = url
  } else {
    normalized.domain = domain
    normalized.path = path
  }

  const expires = normalizeExpires(cookie.expires ?? cookie.expirationDate ?? cookie.expire_time)
  if (typeof expires === 'number') normalized.expires = expires

  const httpOnly = normalizeBoolean(cookie.httpOnly ?? cookie.http_only)
  if (typeof httpOnly === 'boolean') normalized.httpOnly = httpOnly

  const secure = normalizeBoolean(cookie.secure)
  if (typeof secure === 'boolean') normalized.secure = secure

  const sameSite = normalizeSameSite(cookie.sameSite ?? cookie.same_site)
  if (sameSite) normalized.sameSite = sameSite

  return normalized
}

export function normalizeProfileCookiesJson(input: unknown): string | undefined {
  if (typeof input === 'undefined' || input === null) return undefined
  if (typeof input === 'string' && !input.trim()) return ''

  let parsed: unknown = input
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Cookies JSON must be valid JSON: ${message}`)
    }
  }

  const candidates = extractCookieList(parsed)
  const normalized = candidates.map((cookie, index) => normalizeCookie(cookie, index))
  if (normalized.length === 0) {
    throw new Error('Cookies JSON must include at least one cookie')
  }
  return JSON.stringify(normalized)
}
