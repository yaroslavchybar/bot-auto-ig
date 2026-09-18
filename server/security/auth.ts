import '../env.js'
import type { Request, Response, NextFunction } from 'express'
import logger from '../shared/logger.js'
import {
    extractSessionToken,
    verifySessionUid,
    type VerifiedSession,
} from '../auth/telegram.js'

export type { VerifiedSession }

export function isLocalAuthBypassEnabled(): boolean {
    return process.env.NODE_ENV !== 'production' && process.env.DISABLE_AUTH === 'true'
}

const LOCAL_AUTH_BYPASS = isLocalAuthBypassEnabled()

const bypassAuth = (_req: Request, _res: Response, next: NextFunction) => next()

function sessionAuth(req: Request, res: Response, next: NextFunction) {
    const uid = verifySessionUid(extractSessionToken(req))
    if (!uid) {
        res.status(401).json({ error: 'Unauthorized: authentication required' })
        return
    }
    ;(req as any).telegramUid = uid
    next()
}

// Middleware to require authentication for API routes (admin session).
export const requireApiAuth = LOCAL_AUTH_BYPASS ? bypassAuth : sessionAuth

// Internal API key for server-to-server calls (from Convex actions)
const INTERNAL_API_KEY = (process.env.INTERNAL_API_KEY || '').trim()

logger.info({ configured: !!INTERNAL_API_KEY }, 'INTERNAL_API_KEY status')

// Middleware that allows either an admin session OR the internal API key
export function requireApiAuthOrInternalKey(req: Request, res: Response, next: NextFunction) {
    if (LOCAL_AUTH_BYPASS) return next()

    const authHeader = req.headers.authorization || ''

    // Check for internal API key first
    if (INTERNAL_API_KEY && authHeader === `Bearer ${INTERNAL_API_KEY}`) {
        logger.debug('Internal API key matched')
        return next()
    }

    // Fall back to admin session (cookie or Bearer session token)
    return sessionAuth(req, res, next)
}
