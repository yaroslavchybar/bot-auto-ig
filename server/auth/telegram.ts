import crypto from 'node:crypto'

// Telegram Login Widget verification + signed session tokens.
// Ports the widget/session parts of igscrape's server/auth.go. The bot
// deep-link flow is intentionally NOT ported: a Telegram bot can only have
// one webhook, and the shared bot's webhook belongs to igscrape.

export type TelegramUser = {
    id: string
    firstName: string
    lastName?: string
    username?: string
    photoUrl?: string
}

export const SESSION_COOKIE_NAME = 'app_session'
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000
const MAX_AUTH_AGE_SECONDS = 86400
const CLOCK_SKEW_SECONDS = 300

export function getBotToken(): string {
    return (process.env.TELEGRAM_BOT_TOKEN || '').trim()
}

export function getBotUsername(): string {
    return (process.env.TELEGRAM_BOT_USERNAME || '').trim()
}

export function getAdminId(): string {
    return (process.env.TELEGRAM_ADMIN_ID || '').trim()
}

export function isDevLoginEnabled(): boolean {
    return process.env.NODE_ENV !== 'production'
}

export function isTelegramConfigured(): boolean {
    return getBotToken() !== '' && getBotUsername() !== ''
}

function signingKey(): Buffer {
    return crypto.createHash('sha256').update(getBotToken()).digest()
}

function b64urlEncode(data: Buffer | string): string {
    return Buffer.from(data as any)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
}

function b64urlDecode(input: string): Buffer {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
    return Buffer.from(normalized, 'base64')
}

function timingSafeEqualString(a: string, b: string): boolean {
    const aBuf = Buffer.from(a)
    const bBuf = Buffer.from(b)
    if (aBuf.length !== bBuf.length) return false
    return crypto.timingSafeEqual(aBuf, bBuf)
}

export function isAdminTelegramId(telegramId: string): boolean {
    const adminId = getAdminId()
    return adminId !== '' && telegramId === adminId
}

type VerifyResult =
    | { ok: true; user: TelegramUser }
    | { ok: false; error: string }

function toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value.trim())
        return Number.isFinite(parsed) ? parsed : null
    }
    return null
}

// Verifies a Telegram Login Widget payload per
// https://core.telegram.org/widgets/login#checking-authorization
export function verifyTelegramLogin(data: Record<string, unknown>): VerifyResult {
    if (getBotToken() === '') {
        return {
            ok: false,
            error: 'Telegram authentication is not configured on the server. Set TELEGRAM_BOT_TOKEN.',
        }
    }

    const hash = data['hash']
    if (typeof hash !== 'string' || hash === '') {
        return { ok: false, error: 'Missing Telegram authentication hash.' }
    }

    const authDate = toNumber(data['auth_date'])
    if (authDate === null) {
        return { ok: false, error: 'Invalid or missing auth_date.' }
    }
    const nowSeconds = Date.now() / 1000
    if (authDate > nowSeconds + CLOCK_SKEW_SECONDS) {
        return { ok: false, error: 'Authentication data is from the future. Please log in again.' }
    }
    if (nowSeconds - authDate > MAX_AUTH_AGE_SECONDS) {
        return { ok: false, error: 'Authentication data has expired. Please log in again.' }
    }

    const id = toNumber(data['id'])
    if (id === null || id <= 0 || !Number.isInteger(id)) {
        return { ok: false, error: 'Invalid Telegram user id.' }
    }

    const firstName = data['first_name']
    if (typeof firstName !== 'string' || firstName === '') {
        return { ok: false, error: 'Invalid Telegram user data.' }
    }

    // Data-check-string: sorted "key=value" lines, hash excluded.
    const checkString = Object.keys(data)
        .filter((key) => key !== 'hash')
        .sort()
        .map((key) => `${key}=${stringifyWidgetValue(data[key])}`)
        .join('\n')

    const secret = crypto.createHash('sha256').update(getBotToken()).digest()
    const calculated = crypto
        .createHmac('sha256', secret)
        .update(checkString)
        .digest('hex')

    if (!timingSafeEqualString(calculated, hash)) {
        return { ok: false, error: 'Cryptographic hash mismatch. Unauthorized Telegram login.' }
    }

    const user: TelegramUser = { id: String(id), firstName }
    if (typeof data['last_name'] === 'string') user.lastName = data['last_name']
    if (typeof data['username'] === 'string') user.username = data['username']
    if (typeof data['photo_url'] === 'string') user.photoUrl = data['photo_url']
    return { ok: true, user }
}

function stringifyWidgetValue(value: unknown): string {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return JSON.stringify(value) ?? ''
}

export type SessionProfile = {
    firstName: string
    lastName?: string
    username?: string
    photoUrl?: string
}

// ---- Sessions (self-contained HMAC-signed tokens) ----

export function signSession(uid: string, profile?: SessionProfile): string {
    const payload = b64urlEncode(
        JSON.stringify({ uid, exp: Date.now() + SESSION_DURATION_MS, profile }),
    )
    const sig = b64urlEncode(crypto.createHmac('sha256', signingKey()).update(payload).digest())
    return `${payload}.${sig}`
}

export type VerifiedSession = {
    uid: string
    profile: SessionProfile
}

/** Returns the session when the token is valid and belongs to the admin. */
export function verifySession(token: string): VerifiedSession | null {
    if (!token || getBotToken() === '') return null
    const dot = token.indexOf('.')
    if (dot <= 0) return null
    const payload = token.slice(0, dot)
    const sig = token.slice(dot + 1)
    if (!payload || !sig) return null

    const expected = b64urlEncode(
        crypto.createHmac('sha256', signingKey()).update(payload).digest(),
    )
    if (!timingSafeEqualString(expected, sig)) return null

    try {
        const decoded = JSON.parse(b64urlDecode(payload).toString('utf8')) as {
            uid?: unknown
            exp?: unknown
            profile?: SessionProfile
        }
        if (typeof decoded.uid !== 'string' || decoded.uid === '') return null
        if (typeof decoded.exp !== 'number' || Date.now() > decoded.exp) return null
        if (!isAdminTelegramId(decoded.uid)) return null
        const rawProfile: unknown = (decoded as { profile?: unknown }).profile
        const source: Record<string, unknown> =
            rawProfile && typeof rawProfile === 'object'
                ? (rawProfile as Record<string, unknown>)
                : {}
        const firstName = source['firstName']
        return {
            uid: decoded.uid,
            profile: {
                firstName: typeof firstName === 'string' && firstName ? firstName : 'Admin',
                lastName: asOptionalString(source['lastName']),
                username: asOptionalString(source['username']),
                photoUrl: asOptionalString(source['photoUrl']),
            },
        }
    } catch {
        return null
    }
}

function asOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined
}

/** Returns the admin uid when the token is valid, otherwise null. */
export function verifySessionUid(token: string): string | null {
    return verifySession(token)?.uid ?? null
}

export function sessionCookie(token: string): string {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
    return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DURATION_MS / 1000}${secure}`
}

export function logoutCookie(): string {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
    return `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`
}

export function parseCookies(header: string | undefined): Record<string, string> {
    const out: Record<string, string> = {}
    if (!header) return out
    for (const part of header.split(';')) {
        const eq = part.indexOf('=')
        if (eq <= 0) continue
        out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
    }
    return out
}

/** Session token from the httpOnly cookie or an Authorization Bearer header. */
export function extractSessionToken(req: {
    headers: Record<string, string | string[] | undefined>
}): string {
    const cookies = parseCookies(
        typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined,
    )
    if (cookies[SESSION_COOKIE_NAME]) return cookies[SESSION_COOKIE_NAME]
    const auth = req.headers.authorization
    const header = Array.isArray(auth) ? auth[0] : auth
    if (header && header.startsWith('Bearer ')) return header.slice('Bearer '.length).trim()
    return ''
}
