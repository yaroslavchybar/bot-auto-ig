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
import { clerkAuth, requireApiAuth } from './middleware/auth.js'

import automationRouter from './routes/automation.js'
import logsRouter from './routes/logs.js'
import profilesRouter from './routes/profiles.js'
import listsRouter from './routes/lists.js'
import instagramRouter from './routes/instagram.js'


const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..')

// Load environment
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') })

const app = express()
const server = createServer(app)

// Initialize WebSocket
initWebSocket(server)

// CORS middleware - allow frontend requests
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
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

// Protected API Routes - require authentication
app.use('/api/automation', requireApiAuth, automationRouter)
app.use('/api/logs', requireApiAuth, logsRouter)
app.use('/api/profiles', requireApiAuth, profilesRouter)
app.use('/api/lists', requireApiAuth, listsRouter)
app.use('/api/instagram', requireApiAuth, instagramRouter)


const PORT = process.env.SERVER_PORT || 3001

server.listen(PORT, () => {
    console.log(`[Server] API server running on http://localhost:${PORT}`)
    console.log(`[Server] WebSocket available at ws://localhost:${PORT}/ws`)
})
