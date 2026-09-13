import crypto from 'node:crypto'

// Telegram login: signed sessions + bot deep-link login.
// The deep-link flow ports igscrape's server/auth.go: the app jumps straight
// into the Telegram app via tg://resolve (no browser tab), the user taps
// START in the bot, and the frontend polls until the webhook confirms it.
// ig-bot uses its own bot (TELEGRAM_BOT_USERNAME), so its webhook never
// clashes with igscrape's.

export type TelegramUser = {
    id: string
    firstName: string
    lastName?: string
    username?: string
    photoUrl?: string
}

export const SESSION_COOKIE_NAME = 'app_session'
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000

export function getBotToken(): string {
    return (process.env.TELEGRAM_BOT_TOKEN || '').trim()
}

export function getBotUsername(): string {
    return (process.env.TELEGRAM_BOT_USERNAME || '').trim().replace(/^@/, '')
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

// ---- Bot deep-link login (ports igscrape's server/auth.go) ----

export const LOGIN_TOKEN_TTL_MS = 10 * 60 * 1000
export const LOGIN_MAX_PENDING = 1000
export const LOGIN_TOKEN_RE = /^[0-9a-f]{32}$/

export type PendingLoginUser = {
    id: string
    username?: string
    firstName: string
}

type PendingLogin = {
    createdAt: number
    user: PendingLoginUser | null
}

const pendingLogins = new Map<string, PendingLogin>()

// Webhook secret exists from boot and never changes while running.
const loginWebhookSecret = crypto.randomBytes(24).toString('hex')
let loginWebhookReady = false

export function getLoginWebhookSecret(): string {
    return loginWebhookSecret
}

export function isLoginWebhookReady(): boolean {
    return loginWebhookReady
}

export function markLoginWebhookReady(): void {
    loginWebhookReady = true
}

export function sweepPendingLogins(): void {
    const now = Date.now()
    for (const [token, entry] of pendingLogins) {
        if (now - entry.createdAt > LOGIN_TOKEN_TTL_MS) pendingLogins.delete(token)
    }
}

/** Mints a single-use login token, or null when the pending cap is hit. */
export function createPendingLogin(): string | null {
    sweepPendingLogins()
    if (pendingLogins.size >= LOGIN_MAX_PENDING) return null
    const token = crypto.randomBytes(16).toString('hex')
    pendingLogins.set(token, { createdAt: Date.now(), user: null })
    return token
}

/** Snapshot of the entry, or null when missing/expired (expired is deleted). */
export function peekPendingLogin(token: string): PendingLogin | null {
    const entry = pendingLogins.get(token)
    if (!entry || Date.now() - entry.createdAt > LOGIN_TOKEN_TTL_MS) {
        pendingLogins.delete(token)
        return null
    }
    return { createdAt: entry.createdAt, user: entry.user ? { ...entry.user } : null }
}

/** Attaches the Telegram user to an unconfirmed token. False when unknown, expired, or already confirmed. */
export function confirmPendingLogin(token: string, user: PendingLoginUser): boolean {
    const entry = pendingLogins.get(token)
    if (!entry || Date.now() - entry.createdAt > LOGIN_TOKEN_TTL_MS || entry.user) {
        return false
    }
    entry.user = user
    return true
}

/** Atomically single-use consumes a confirmed token. Null when missing, expired, or still pending. */
export function consumePendingLogin(token: string): PendingLogin | null {
    const entry = pendingLogins.get(token)
    if (!entry || Date.now() - entry.createdAt > LOGIN_TOKEN_TTL_MS) {
        pendingLogins.delete(token)
        return null
    }
    if (!entry.user) return entry
    pendingLogins.delete(token)
    return entry
}

// Small in-memory limiter for public login endpoints.
const loginRateWindows = new Map<string, { count: number; resetAt: number }>()

export function allowLoginAttempt(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now()
    if (loginRateWindows.size > 5000) {
        for (const [k, w] of loginRateWindows) {
            if (w.resetAt <= now) loginRateWindows.delete(k)
        }
    }
    const window = loginRateWindows.get(key)
    if (!window || window.resetAt <= now) {
        loginRateWindows.set(key, { count: 1, resetAt: now + windowMs })
        return true
    }
    if (window.count >= limit) return false
    window.count++
    return true
}

async function botApi(method: string, body: Record<string, unknown>): Promise<unknown> {
    const botToken = getBotToken()
    if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN is not configured')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        })
        const out = (await res.json().catch(() => null)) as {
            ok?: boolean
            result?: unknown
            description?: string
        } | null
        if (!res.ok || !out?.ok) {
            throw new Error(out?.description || `Telegram API ${method} failed`)
        }
        return out.result
    } finally {
        clearTimeout(timeout)
    }
}

/** Public base URL the Telegram webhook calls back (no trailing slash). */
export function getPublicBaseUrl(): string {
    const raw =
        process.env.PUBLIC_BASE_URL ||
        process.env.APP_PUBLIC_URL ||
        (process.env.ALLOWED_ORIGINS || '').split(',')[0] ||
        ''
    return raw.trim().replace(/\/+$/, '')
}

export async function registerLoginWebhook(baseURL: string): Promise<void> {
    await botApi('setWebhook', {
        url: `${baseURL}/api/auth/tg-webhook`,
        secret_token: loginWebhookSecret,
        drop_pending_updates: true,
    })
    markLoginWebhookReady()
}

export async function sendLoginConfirmation(chatId: number): Promise<void> {
    await botApi('sendMessage', {
        chat_id: chatId,
        text: 'Logged in. Return to the site to continue.',
    })
}
