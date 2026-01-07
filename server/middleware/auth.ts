import { clerkMiddleware, requireAuth, getAuth } from '@clerk/express'
import type { Request, Response, NextFunction } from 'express'

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
