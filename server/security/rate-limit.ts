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

/**
 * Stricter limit for automation routes - 10 requests per minute.
 * Prevents accidental spam of start/stop commands.
 */
export const automationLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many automation requests' } },
    standardHeaders: true,
    legacyHeaders: false,
})

/**
 * Stricter limit for write operations - 30 per minute.
 * Applies to profile/list creation, updates, deletes.
 */
export const writeLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many write requests' } },
    standardHeaders: true,
    legacyHeaders: false,
})
