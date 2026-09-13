import { Router } from 'express'
import type { Request, Response } from 'express'
import {
    allowLoginAttempt,
    confirmPendingLogin,
    consumePendingLogin,
    createPendingLogin,
    extractSessionToken,
    getAdminId,
    getBotUsername,
    getLoginWebhookSecret,
    isAdminTelegramId,
    isDevLoginEnabled,
    isLoginWebhookReady,
    isTelegramConfigured,
    LOGIN_TOKEN_RE,
    logoutCookie,
    peekPendingLogin,
    sendLoginConfirmation,
    sessionCookie,
    signSession,
    verifySession,
    type TelegramUser,
} from './telegram.js'
import logger from '../shared/logger.js'

// Public auth endpoints. Mounted at /api/auth BEFORE the protected routes.

export const authRouter = Router()

authRouter.get('/config', (_req: Request, res: Response) => {
    res.json({
        botUsername: getBotUsername(),
        isConfigured: isTelegramConfigured(),
        isDevLoginEnabled: isDevLoginEnabled(),
    })
})

// App-open login (same as igscrape): mint a single-use token, jump straight
// into the Telegram app via tg:// (no browser tab), and poll until the user
// taps START in the bot and the webhook confirms the token.
authRouter.post('/tg-link', (req: Request, res: Response) => {
    if (!isTelegramConfigured()) {
        res.status(400).json({ error: 'Telegram login is not configured on the server.' })
        return
    }
    if (!isLoginWebhookReady()) {
        res.status(503).json({ error: 'Telegram login is not available right now. Try again shortly.' })
        return
    }
    if (!allowLoginAttempt(`tg-link:${clientIp(req)}`, 10, 60_000)) {
        res.status(429).json({ error: 'Too many login attempts. Try again in a minute.' })
        return
    }
    const token = createPendingLogin()
    if (!token) {
        res.status(429).json({ error: 'Login is busy. Try again shortly.' })
        return
    }
    const bot = getBotUsername()
    res.json({ token, bot, url: `https://t.me/${bot}?start=${token}` })
})

authRouter.get('/tg-poll', (req: Request, res: Response) => {
    if (!allowLoginAttempt(`tg-poll:${clientIp(req)}`, 120, 60_000)) {
        res.status(429).json({ error: 'Polling too fast. Slow down.' })
        return
    }
    const token = typeof req.query.token === 'string' ? req.query.token : ''
    if (!LOGIN_TOKEN_RE.test(token)) {
        res.status(404).json({ status: 'expired' })
        return
    }
    const peeked = peekPendingLogin(token)
    if (!peeked) {
        res.status(404).json({ status: 'expired' })
        return
    }
    if (!peeked.user) {
        res.json({ status: 'pending' })
        return
    }
    const entry = consumePendingLogin(token)
    if (!entry?.user) {
        res.status(404).json({ status: 'expired' })
        return
    }
    if (!isAdminTelegramId(entry.user.id)) {
        logger.warn({ telegramId: entry.user.id }, 'Non-admin Telegram login rejected')
        res.status(403).json({ error: 'Access is restricted to the admin.' })
        return
    }
    issueSession(res, {
        id: entry.user.id,
        firstName: entry.user.firstName,
        username: entry.user.username,
    })
})

authRouter.post('/tg-webhook', (req: Request, res: Response) => {
    if (req.header('X-Telegram-Bot-Api-Secret-Token') !== getLoginWebhookSecret()) {
        res.status(401).json({ ok: false })
        return
    }
    try {
        const message = (req.body as Record<string, unknown> | undefined)?.['message'] as
            | { text?: unknown; from?: { id?: unknown; username?: unknown; first_name?: unknown } }
            | undefined
        const text = message?.text
        const from = message?.from
        const match = typeof text === 'string' ? text.match(/^\/start\s+([0-9a-f]{32})/) : null
        const chatId = typeof from?.id === 'number' && Number.isInteger(from.id) ? from.id : 0
        if (match && chatId > 0) {
            const rawFirstName = from?.first_name
            const rawUsername = from?.username
            const confirmed = confirmPendingLogin(match[1], {
                id: String(chatId),
                username: typeof rawUsername === 'string' ? rawUsername : undefined,
                firstName:
                    typeof rawFirstName === 'string' && rawFirstName ? rawFirstName : 'User',
            })
            if (confirmed) {
                sendLoginConfirmation(chatId).catch((err) => {
                    logger.warn({ err }, 'Telegram login confirmation message failed')
                })
            }
        }
    } catch (err) {
        logger.warn({ err }, 'Telegram webhook payload error')
    }
    res.json({ ok: true })
})

authRouter.get('/me', (req: Request, res: Response) => {
    const session = verifySession(extractSessionToken(req))
    if (!session) {
        res.json({
            authenticated: false,
            botUsername: getBotUsername(),
            isConfigured: isTelegramConfigured(),
            isDevLoginEnabled: isDevLoginEnabled(),
        })
        return
    }

    res.json({
        authenticated: true,
        user: toClientUser({ id: session.uid, ...session.profile }),
    })
})

// Dev login for localhost: deep-link login needs a public HTTPS URL for the
// Telegram webhook, so local development uses a one-click session.
authRouter.post('/dev-login', (_req: Request, res: Response) => {
    if (!isDevLoginEnabled()) {
        res.status(403).json({ error: 'Dev login is disabled' })
        return
    }

    issueSession(res, {
        id: getAdminId() || '1',
        firstName: 'Dev Admin',
        username: 'admin',
    })
})

authRouter.post('/logout', (_req: Request, res: Response) => {
    res.setHeader('Set-Cookie', logoutCookie())
    res.json({ success: true })
})

export function clientIp(req: Request): string {
    // req.ip honours the configured `trust proxy` hop count, so a
    // client-supplied X-Forwarded-For entry cannot become the key.
    return req.ip || req.socket?.remoteAddress || 'unknown'
}

function issueSession(res: Response, user: TelegramUser) {
    const token = signSession(user.id, {
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        photoUrl: user.photoUrl,
    })
    res.setHeader('Set-Cookie', sessionCookie(token))
    res.json({ user: toClientUser(user), token })
}

function toClientUser(user: TelegramUser) {
    return {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName || '',
        fullName:
            [user.firstName, user.lastName].filter(Boolean).join(' ') || user.firstName,
        username: user.username || '',
        photoUrl: user.photoUrl || '',
    }
}
