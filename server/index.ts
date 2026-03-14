/**
 * Backend API Server for Vue Frontend
 * Handles Python subprocess control and WebSocket communication
 */
import './env.js'
// Sentry must be initialized before Express app creation
import { Sentry } from './shared/sentry.js'

import express from 'express'
import { createServer } from 'http'

import { initWebSocket } from './websocket.js'
import { clerkAuth, requireApiAuth, requireApiAuthOrInternalKey } from './security/auth.js'

import automationRouter from './api/automation.js'
import logsRouter from './api/logs.js'
import { profilesRouter } from './profiles/index.js'
import listsRouter from './api/lists.js'
import workflowsRouter from './api/workflows.js'
import monitoringRouter from './api/monitoring.js'
import displaysRouter from './api/displays.js'
import { cleanupOrphanedProcesses } from './automation/process-manager.js'
import { profileManager } from './profiles/index.js'
import { profileProcesses } from './store.js'
import { apiLimiter, automationLimiter } from './security/rate-limit.js'
import logger from './shared/logger.js'
import { AppError } from './shared/errors.js'
import type { Request, Response, NextFunction } from 'express'

const app = express()
const server = createServer(app)

// Initialize WebSocket
initWebSocket(server)

// CORS configuration
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3000').split(',').map(o => o.trim())
const IS_DEV = process.env.NODE_ENV !== 'production'

// CORS middleware - environment-aware origin checking
app.use((req, res, next) => {
    const origin = req.headers.origin

    // In development, allow all origins. In production, check whitelist.
    if (IS_DEV) {
        res.header('Access-Control-Allow-Origin', origin || '*')
    } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin)
    }
    // If origin is not allowed in production, don't set the header (browser will block)

    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.header('Access-Control-Allow-Credentials', 'true')

    if (req.method === 'OPTIONS') {
        return res.sendStatus(200)
    }
    next()
})

app.use(express.json())

// HTTP request logging middleware
let requestCounter = 0
app.use((req, res, next) => {
    const reqId = ++requestCounter
    const start = Date.now()
    ;(req as any).id = reqId

    res.on('finish', () => {
        logger.info({
            reqId,
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            duration: Date.now() - start,
        }, 'HTTP request')
    })
    next()
})

// Initialize Clerk middleware (parses auth tokens)
app.use(clerkAuth)

// Health check (public)
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Protected API Routes - require authentication and rate limiting
app.use('/api/automation', requireApiAuth, automationLimiter, automationRouter)
app.use('/api/logs', requireApiAuth, apiLimiter, logsRouter)
app.use('/api/profiles', requireApiAuth, apiLimiter, profilesRouter)
app.use('/api/lists', requireApiAuth, apiLimiter, listsRouter)
app.use('/api/workflows', requireApiAuthOrInternalKey, apiLimiter, workflowsRouter)
app.use('/api/monitoring', requireApiAuth, apiLimiter, monitoringRouter)
app.use('/api/displays', requireApiAuth, apiLimiter, displaysRouter)

// Sentry error handler must be registered after all routes
Sentry.setupExpressErrorHandler(app)

// Global error-handling middleware (4-argument signature).
// Registered AFTER the Sentry handler so Sentry captures the error first.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
        logger.warn({ err, statusCode: err.statusCode, code: err.code }, err.message)
        res.status(err.statusCode).json({
            success: false,
            error: { code: err.code, message: err.message },
        })
        return
    }

    // Unexpected / untyped errors → 500
    logger.error({ err }, 'Unhandled error')
    res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
})

const PORT = process.env.SERVER_PORT || 3001

async function startServer(): Promise<void> {
    // Clean up any orphaned processes from previous server runs
    await cleanupOrphanedProcesses()

    // Reset stale profile runtime flags left behind by unexpected restarts.
    const reconciled = await profileManager.reconcileRuntimeStatuses(profileProcesses.keys())
    if (reconciled.cleared > 0) {
        logger.info({ cleared: reconciled.cleared }, 'Cleared stale running status for profile(s)')
    }
    if (reconciled.errors.length > 0) {
        for (const err of reconciled.errors) {
            logger.error({ err }, 'Reconciliation error')
        }
    }

    server.listen(PORT, () => {
        logger.info({ port: PORT }, 'API server running')
        logger.info({ port: PORT }, 'WebSocket available')
    })
}

startServer().catch((err) => {
    logger.fatal({ err }, 'Startup failed')
    process.exit(1)
})
