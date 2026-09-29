/**
 * Rate limiting middleware for API routes.
 * Prevents abuse and protects against accidental infinite loops.
 */
import rateLimit from 'express-rate-limit'
import type { Request } from 'express'

const modelImagePath = /^\/api\/ig-accounts\/models\/[^/]+\/content\/(?:posts|avatars)\/[^/]+\/(?:image|copies\/[^/]+\/image)$/

function isModelImageRead(req: Request): boolean {
    return req.method === 'GET' && modelImagePath.test(req.originalUrl.split('?')[0])
}

/**
 * General API rate limit - 100 requests per minute.
 */
export const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100,
    skip: isModelImageRead,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' } },
    standardHeaders: true,
    legacyHeaders: false,
})

/** Model galleries can load many images at once without using the general API quota. */
export const modelImageLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 600,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many image requests, please try again later' } },
    standardHeaders: true,
    legacyHeaders: false,
})
