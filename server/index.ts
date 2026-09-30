/**
 * Backend API Server for Vue Frontend
 * Handles Bun subprocess control and WebSocket communication
 */
import './env.js'
// Sentry must be initialized before Express app creation
import { Sentry } from './shared/sentry.js'

import express from 'express'
import { createServer } from 'http'

import { initWebSocket } from './websocket.js'
import { requireApiAuth, requireApiAuthOrInternalKey } from './security/auth.js'
import { authRouter } from './auth/routes.js'

import { requestLogging } from './logs/middleware.js'
import { captureConsole } from './logs/console.js'
import { profilesRouter } from './profiles/index.js'
import { automationsRouter } from './automations/index.js'
import displaysRouter from './displays/routes.js'
import leadListsRouter from './leads/routes.js'
import chatRouter from './chat/routes.js'
import igAccountsRouter from './ig-accounts/routes.js'
import { startIgAccountWorker } from './ig-accounts/login.js'
import { startModelWarmupWorker } from './ig-accounts/warmup.js'
import { startChatWorker } from './chat/worker.js'
import { registerShutdownHandlers } from './automation/shutdown.js'
import { profileManager } from './profiles/index.js'
import { pruneOldCloakBrowsers } from './browser/cloakCache.js'
import { backfillLocalCloakSeeds } from './browser/seedBackfill.js'
import { retryProfileMaintenance, startProfileMaintenance } from './profiles/maintenance.js'
import { getActiveRuntimeProfileNames } from './shared/store.js'
import { apiLimiter } from './security/rate-limit.js'
import { getPublicBaseUrl, registerLoginWebhook } from './auth/telegram.js'
import logger, { logOperation, addLogContext } from './shared/logger.js'
import { automationsReconcileInterrupted } from './shared/convexClient.js'
import { cleanupOrphanedProcesses } from './shared/ProcessService.js'
import { AppError } from './shared/errors.js'
import { startScraperWorker } from './scraper/worker.js'
import type { Request, Response, NextFunction } from 'express'
import { startRuntime } from './shared/runtime.js'

const app = express()
captureConsole()
const server = createServer(app)
app.use(requestLogging)

// Trust exactly the known proxy hops in front of the server so req.ip is the
// real client IP: Caddy (HTTPS entry) -> frontend nginx (/api/ proxy).
// A client-supplied X-Forwarded-For entry stays beyond the trusted hops and
// can never become req.ip — the rate-limit key.
app.set('trust proxy', 2)

// Initialize WebSocket
const wss = initWebSocket(server)

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
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Telegram-Bot-Api-Secret-Token, X-Request-Id')
    res.header('Access-Control-Expose-Headers', 'X-Request-Id')
    res.header('Access-Control-Allow-Credentials', 'true')

    if (req.method === 'OPTIONS') {
        return res.sendStatus(200)
    }
    next()
})

const jsonParser = express.json({ limit: '1mb' })
app.use((req, _res, next) => {
    // File bytes are streamed to the browser worker without JSON parsing.
    if (req.method === 'POST' && /^\/api\/displays\/\d+\/file-picker$/.test(req.path)) return next()
    if (req.method === 'POST' && /^\/api\/chat\/[^/]+\/threads\/[^/]+\/attachment$/.test(req.path)) return next()
    jsonParser(req, _res, next)
})

// Public auth endpoints (Telegram login, session, logout)
// Health check (public)
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/auth', authRouter)

// Protected API Routes - require authentication and rate limiting
app.use('/api/profiles', requireApiAuth, apiLimiter, profilesRouter)
app.use('/api/automations', requireApiAuthOrInternalKey, apiLimiter, automationsRouter)
app.use('/api/displays', requireApiAuth, apiLimiter, displaysRouter)
app.use('/api/lead-lists', requireApiAuth, apiLimiter, leadListsRouter)
app.use('/api/chat', requireApiAuth, apiLimiter, chatRouter)
app.use('/api/ig-accounts', requireApiAuth, apiLimiter, igAccountsRouter)

startIgAccountWorker()
startModelWarmupWorker()

// Sentry error handler must be registered after all routes
Sentry.setupExpressErrorHandler(app)

// Global error-handling middleware (4-argument signature).
// Registered AFTER the Sentry handler so Sentry captures the error first.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
        addLogContext({ error: err, code: err.code })
        res.status(err.statusCode).json({
            success: false,
            error: { code: err.code, message: err.message },
        })
        return
    }

    // Unexpected / untyped errors → 500
    logger.error({ event: 'index.unhandled_error', error: err, message: 'Unhandled error', outcome: 'error' })
    res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
})

const PORT = process.env.SERVER_PORT || 3001

const STARTUP_RETRY_ATTEMPTS = 10
const STARTUP_RETRY_DELAY_MS = 3000

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Retry a startup step while Convex dev is still deploying. Throws on final failure. */
async function retryStartup<T>(step: () => Promise<T>, label: string): Promise<T> {
    let lastError: unknown
    for (let attempt = 1; attempt <= STARTUP_RETRY_ATTEMPTS; attempt++) {
        try {
            return await step()
        } catch (err) {
            lastError = err
            if (attempt === STARTUP_RETRY_ATTEMPTS) break
            logger.info({ event: 'startup.retry', attempt, step: label, error: err })
            await sleep(STARTUP_RETRY_DELAY_MS)
        }
    }
    throw lastError
}

async function startServer(): Promise<void> {
  return logOperation('server.startup', { port: PORT }, async () => {
    // Register graceful shutdown handlers (SIGTERM/SIGINT)
    registerShutdownHandlers({ httpServer: server, wss })


    // Kill stale automation processes left behind by a crash. Detached
    // children survive restarts, so reconcile them before touching flags.
    await cleanupOrphanedProcesses()
    await startRuntime()
    const prunedBinaries = pruneOldCloakBrowsers()
    addLogContext({ prunedBinaryCount: prunedBinaries.length })
    if (prunedBinaries.length > 0) {
        logger.info({ event: 'index.pruned_superseded_cloak_browser_binaries', pruned: prunedBinaries, message: 'Pruned superseded Cloak browser binaries' })
    }
    await retryProfileMaintenance()
    server.once('close', startProfileMaintenance())

    // Convex dev deploys alongside the server, so the reconcile endpoint
    // may 404 until the new functions are live. Retry instead of crashing.
    await retryStartup(() => automationsReconcileInterrupted(), 'automation reconcile')

    await retryStartup(backfillLocalCloakSeeds, 'Cloak fingerprint seed backfill')
    logger.info({ event: 'index.cloak_fingerprint_seed_backfill_complete', message: 'Cloak fingerprint seed backfill complete' })

    // Reset stale profile runtime flags left behind by unexpected restarts.
    const reconciled = await profileManager.reconcileRuntimeStatuses(getActiveRuntimeProfileNames())
    addLogContext({ reconciledProfileCount: reconciled.cleared, reconciliationErrorCount: reconciled.errors.length })
    if (reconciled.cleared > 0) {
        logger.info({ event: 'index.cleared_stale_running_status_for', cleared: reconciled.cleared, message: 'Cleared stale running status for profile(s)' })
    }
    if (reconciled.errors.length > 0) {
        for (const err of reconciled.errors) {
            logger.error({ event: 'index.reconciliation_error', error: err, message: 'Reconciliation error', outcome: 'error' })
        }
    }

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(PORT, () => {
        server.off('error', reject)
        resolve()
        const stopRoutineScheduler = startRoutineScheduler()
        server.once('close', stopRoutineScheduler)
        const stopScraperWorker = startScraperWorker()
        server.once('close', stopScraperWorker)
        server.once('close', startChatWorker())
        addLogContext({ listening: true, websocketEnabled: true })
        // Point the bot at our webhook so deep-link logins complete.
        // Best-effort: a failure only disables app-open login. Telegram must
        // reach us over HTTPS, so local dev (no public URL) stays on dev login.
        setTimeout(() => {
            const base = getPublicBaseUrl()
            if (!base) return
            registerLoginWebhook(base).then(
                () => logger.info({ event: 'index.telegram_login_webhook_registered', message: 'Telegram login webhook registered' }),
                (err) => logger.error({ event: 'index.telegram_login_webhook_failed', error: err, message: 'Telegram login webhook failed', outcome: 'error' }),
            )
        }, 2000)
      })
    })

  })
}

startServer().catch(() => {
    // Startup emits its completion event before rejecting.
    process.exit(1)
})
import { startRoutineScheduler } from './automations/scheduler.js'
