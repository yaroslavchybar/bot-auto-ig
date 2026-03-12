/**
 * Backend API Server for Vue Frontend
 * Handles Python subprocess control and WebSocket communication
 */
import express from 'express'
import { createServer } from 'http'
import './env.js'

import { initWebSocket } from './websocket.js'
import { clerkAuth, requireApiAuth, requireApiAuthOrInternalKey } from './security/auth.js'

import automationRouter from './api/automation.js'
import logsRouter from './api/logs.js'
import profilesRouter from './api/profiles.js'
import listsRouter from './api/lists.js'
import workflowsRouter from './api/workflows.js'
import monitoringRouter from './api/monitoring.js'
import displaysRouter from './api/displays.js'
import { cleanupOrphanedProcesses } from './automation/process-manager.js'
import { profileManager } from './data/profiles.js'
import { profileProcesses } from './store.js'
import { apiLimiter, automationLimiter } from './security/rate-limit.js'

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


const PORT = process.env.SERVER_PORT || 3001

async function startServer(): Promise<void> {
    // Clean up any orphaned processes from previous server runs
    await cleanupOrphanedProcesses()

    // Reset stale profile runtime flags left behind by unexpected restarts.
    const reconciled = await profileManager.reconcileRuntimeStatuses(profileProcesses.keys())
    if (reconciled.cleared > 0) {
        console.log(`[Server] Cleared stale running status for ${reconciled.cleared} profile(s)`)
    }
    if (reconciled.errors.length > 0) {
        for (const err of reconciled.errors) {
            console.error(`[Server] ${err}`)
        }
    }

    server.listen(PORT, () => {
        console.log(`[Server] API server running on http://localhost:${PORT}`)
        console.log(`[Server] WebSocket available at ws://localhost:${PORT}/ws`)
    })
}

startServer().catch((err) => {
    console.error('[Server] Startup failed:', err)
    process.exit(1)
})
