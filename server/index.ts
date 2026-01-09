/**
 * Backend API Server for Vue Frontend
 * Handles Python subprocess control and WebSocket communication
 */
import express from 'express'
import { createServer } from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

import { initWebSocket } from './websocket.js'
import { clerkAuth, requireApiAuth } from './security/auth.js'

import automationRouter from './api/automation.js'
import logsRouter from './api/logs.js'
import profilesRouter from './api/profiles.js'
import listsRouter from './api/lists.js'
import instagramRouter from './api/instagram.js'
import scrapingRouter from './api/scraping.js'
import { cleanupOrphanedProcesses } from './automation/process-manager.js'
import { apiLimiter, automationLimiter } from './security/rate-limit.js'


const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..')

// Load environment
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') })

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
app.use('/api/instagram', requireApiAuth, apiLimiter, instagramRouter)
app.use('/api/scraping', requireApiAuth, apiLimiter, scrapingRouter)


const PORT = process.env.SERVER_PORT || 3001

// Clean up any orphaned processes from previous server runs
cleanupOrphanedProcesses().then(() => {
    server.listen(PORT, () => {
        console.log(`[Server] API server running on http://localhost:${PORT}`)
        console.log(`[Server] WebSocket available at ws://localhost:${PORT}/ws`)
    })
})
