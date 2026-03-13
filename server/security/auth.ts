import '../env.js'
import { clerkMiddleware, requireAuth, getAuth } from '@clerk/express'
import type { Request, Response, NextFunction } from 'express'
import logger from '../shared/logger.js'

// Initialize Clerk middleware
export const clerkAuth = clerkMiddleware()

// Middleware to require authentication for API routes
export const requireApiAuth = requireAuth()

// Helper to get user info from request
export function getRequestAuth(req: Request) {
    return getAuth(req)
}

// Middleware that optionally requires auth (for routes that should work both ways)
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
    // Skip auth check for health/status endpoints if needed
    next()
}

// Internal API key for server-to-server calls (from Convex cron jobs)
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || ''

logger.info({ configured: !!INTERNAL_API_KEY }, 'INTERNAL_API_KEY status')

// Middleware that allows either Clerk auth OR internal API key
export function requireApiAuthOrInternalKey(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization || ''

    // Check for internal API key first
    if (INTERNAL_API_KEY && authHeader === `Bearer ${INTERNAL_API_KEY}`) {
        logger.debug('Internal API key matched')
        return next()
    }

    // Fall back to Clerk auth
    return requireAuth()(req, res, next)
}
