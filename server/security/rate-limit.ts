/**
 * Rate limiting middleware for API routes.
 * Prevents abuse and protects against accidental infinite loops.
 */
import rateLimit from 'express-rate-limit'

/**
 * General API rate limit - 100 requests per minute.
 */
export const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' } },
    standardHeaders: true,
    legacyHeaders: false,
})
