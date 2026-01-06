
import { Router } from 'express'
import { spawn, execFile } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { automationState } from '../store.js'
import { broadcast } from '../websocket.js'
import { profilesSetLoginTrue } from '../lib/convex.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const PYTHON_RUNNER = path.join(PROJECT_ROOT, 'scripts', 'instagram_automation.py')
const LOGIN_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'login_automation.py')

const router = Router()

// Get automation status
router.get('/status', (req, res) => {
    res.json({
        status: automationState.status,
        running: automationState.status === 'running',
    })
})

// Start automation
router.post('/start', async (req, res) => {
    if (automationState.process) {
        return res.status(400).json({ error: 'Automation already running' })
    }

    const settings = req.body

    try {
        automationState.status = 'running'
        broadcast({ type: 'status', status: 'running' })
        broadcast({ type: 'log', message: 'Starting automation...', level: 'info', source: 'server' })

        // Spawn Python process with stdin for settings
        automationState.process = spawn('python', [PYTHON_RUNNER], {
            cwd: PROJECT_ROOT,
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe']
        })

        // Send settings via stdin
        const payload = JSON.stringify({ settings })
        automationState.process.stdin?.write(payload)
        automationState.process.stdin?.end()

        // Handle stdout
        automationState.process.stdout?.on('data', (data) => {
            const message = data.toString().trim()
            if (message) {
                console.log('[Python]', message)
                broadcast({ type: 'log', message, level: 'info', source: 'python' })
            }
        })

        // Handle stderr
        automationState.process.stderr?.on('data', (data) => {
            const message = data.toString().trim()
            if (message) {
                console.error('[Python Error]', message)
                broadcast({ type: 'log', message, level: 'error', source: 'python' })
            }
        })

        // Handle process exit
        automationState.process.on('close', (code) => {
            console.log(`[Python] Process exited with code ${code}`)
            automationState.process = null
            automationState.status = 'idle'
            broadcast({ type: 'status', status: 'idle' })
            broadcast({
                type: 'log',
                message: `Automation finished with code ${code}`,
                level: code === 0 ? 'success' : 'warn',
                source: 'server',
            })
        })

        automationState.process.on('error', (err) => {
            console.error('[Python] Process error:', err)
            automationState.process = null
            automationState.status = 'idle'
            broadcast({ type: 'status', status: 'idle' })
            broadcast({
                type: 'log',
                message: `Automation error: ${err.message}`,
                level: 'error',
                source: 'server',
            })
        })

        res.json({ success: true, message: 'Automation started' })
    } catch (error) {
        automationState.status = 'idle'
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

// Stop automation
router.post('/stop', async (req, res) => {
    if (!automationState.process) {
        return res.status(400).json({ error: 'No automation running' })
    }

    automationState.status = 'stopping'
    broadcast({ type: 'status', status: 'stopping' })
    broadcast({ type: 'log', message: 'Stopping automation...', level: 'warn', source: 'server' })

    try {
        // On Windows, we need to use taskkill to kill the process tree
        if (process.platform === 'win32' && automationState.process.pid) {
            await new Promise<void>((resolve, reject) => {
                execFile('taskkill', ['/pid', String(automationState.process!.pid), '/t', '/f'], (err) => {
                    if (err) {
                        console.error('[Taskkill Error]', err)
                    }
                    resolve()
                })
            })
        } else {
            automationState.process.kill('SIGTERM')
        }

        // Wait for process to exit
        await new Promise((resolve) => setTimeout(resolve, 1000))

        if (automationState.process) {
            automationState.process.kill('SIGKILL')
            automationState.process = null
        }

        automationState.status = 'idle'
        broadcast({ type: 'status', status: 'idle' })
        broadcast({ type: 'log', message: 'Automation stopped', level: 'info', source: 'server' })

        res.json({ success: true, message: 'Automation stopped' })
    } catch (error) {
        automationState.status = 'idle'
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

// Start login automation
router.post('/login', async (req, res) => {
    const { profileName, username, password, twoFactorSecret, headless } = req.body

    if (!profileName || !username || !password) {
        return res.status(400).json({ error: 'profileName, username, and password are required' })
    }

    try {
        broadcast({
            type: 'log',
            message: `Starting login for profile: ${profileName}`,
            level: 'info',
            source: 'server',
        })

        const args = [LOGIN_SCRIPT, '--profile', profileName]
        if (headless) {
            args.push('--headless')
        }

        const loginProcess = spawn('python', args, {
            cwd: PROJECT_ROOT,
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe']
        })

        // Send credentials via stdin
        const credentials = JSON.stringify({
            username,
            password,
            two_factor_secret: twoFactorSecret || null
        })
        loginProcess.stdin.write(credentials)
        loginProcess.stdin.end()

        loginProcess.stdout?.on('data', (data) => {
            const message = data.toString().trim()
            if (message) {
                // Check for success signal
                if (message.includes('__LOGIN_SUCCESS__')) {
                    broadcast({ type: 'log', message: 'Login Successful', level: 'success', source: 'login' })
                    // Auto-mark profile as logged in
                    profilesSetLoginTrue(profileName).catch(err => {
                        console.error('[Login Auto-Update Error]', err)
                    })
                }
                broadcast({ type: 'log', message, level: 'info', source: 'login' })
            }
        })

        loginProcess.stderr?.on('data', (data) => {
            const message = data.toString().trim()
            if (message) {
                broadcast({ type: 'log', message, level: 'error', source: 'login' })
            }
        })

        loginProcess.on('close', (code) => {
            broadcast({
                type: 'log',
                message: `Login process finished with code ${code}`,
                level: code === 0 ? 'success' : 'warn',
                source: 'server',
            })
        })

        res.json({ success: true, message: `Login started for ${profileName}` })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

export default router
