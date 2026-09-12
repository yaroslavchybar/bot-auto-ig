import { Router } from 'express'
import type { Request, Response } from 'express'
import {
    extractSessionToken,
    getAdminId,
    getBotUsername,
    isAdminTelegramId,
    isDevLoginEnabled,
    isTelegramConfigured,
    logoutCookie,
    sessionCookie,
    signSession,
    verifySession,
    verifyTelegramLogin,
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

authRouter.post('/login', (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>
    const result = verifyTelegramLogin(body)

    if (!result.ok) {
        res.status(401).json({ error: result.error })
        return
    }

    if (!isAdminTelegramId(result.user.id)) {
        logger.warn({ telegramId: result.user.id }, 'Non-admin Telegram login rejected')
        res.status(403).json({ error: 'Access is restricted to the admin.' })
        return
    }

    issueSession(res, result.user)
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

// Dev login for localhost: the Telegram widget only works on the domain
// registered with BotFather, so local development uses a one-click session.
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
