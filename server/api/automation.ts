
import { Router } from 'express'
import { spawn, execFile } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { automationState } from '../store.js'
import { broadcast } from '../websocket.js'
import { profilesSetLoginTrue } from '../data/convex.js'
import { automationMutex } from '../helpers/mutex.js'
import { savePid, clearPid } from '../automation/process-manager.js'
import { errorResponse, ErrorCodes } from '../helpers/errors.js'
import { validateSettings } from '../helpers/settings-schema.js'
import { markStarted, markStopped } from '../automation/state.js'
import { parseLogOutput } from '../logs/parser.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// From dist/routes/ we need to go up to server/, then up to project root
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const PYTHON_RUNNER = path.join(PROJECT_ROOT, 'python', 'getting_started', 'run_multiple_accounts.py')
const LOGIN_SCRIPT = path.join(PROJECT_ROOT, 'python', 'instagram_actions', 'login', 'session.py')

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
    const release = await automationMutex.acquire()

    try {
        if (automationState.process) {
            return res.status(400).json(errorResponse(ErrorCodes.AUTOMATION_RUNNING, 'Automation already running'))
        }

        const validationResult = validateSettings(req.body)
        if (validationResult instanceof Error) {
            return res.status(400).json(errorResponse(ErrorCodes.VALIDATION_ERROR, validationResult.message))
        }
        const settings = validationResult

        automationState.status = 'running'
        broadcast({ type: 'status', status: 'running' })
        broadcast({ type: 'log', message: 'Starting automation...', level: 'info', source: 'server' })

        // Spawn Python process with stdin for settings
        // Use detached on Linux to create a process group we can kill
        // -u flag disables output buffering so logs stream in real-time
        automationState.process = spawn('python', ['-u', PYTHON_RUNNER], {
            cwd: PROJECT_ROOT,
            detached: process.platform !== 'win32',
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONPATH: PROJECT_ROOT },
        })

        // Send settings via stdin
        const payload = JSON.stringify({ settings })
        automationState.process.stdin?.write(payload)
        automationState.process.stdin?.end()

        // Track PID for orphan cleanup on server restart
        if (automationState.process.pid) {
            savePid(automationState.process.pid)
            markStarted(automationState.process.pid, settings as Record<string, unknown>)
        }

        // Handle stdout - parse and format logs
        automationState.process.stdout?.on('data', (data) => {
            const raw = data.toString()
            const parsed = parseLogOutput(raw)

            for (const log of parsed) {
                console.log(`[Python] ${log.message}`)
                broadcast({
                    type: log.eventType ? log.eventType : 'log',
                    message: log.message,
                    level: log.level,
                    source: 'python',
                    ...log.metadata
                })
            }
        })

        // Handle stderr - parse and format as errors
        automationState.process.stderr?.on('data', (data) => {
            const raw = data.toString()
            const parsed = parseLogOutput(raw)

            for (const log of parsed) {
                console.error(`[Python Error] ${log.message}`)
                broadcast({
                    type: 'log',
                    message: log.message,
                    level: 'error',
                    source: 'python'
                })
            }
        })

        // Handle process exit
        automationState.process.on('close', (code) => {
            console.log(`[Python] Process exited with code ${code}`)
            clearPid()
            markStopped()
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
            clearPid()
            markStopped()
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
        res.status(500).json(errorResponse(ErrorCodes.INTERNAL_ERROR, message))
    } finally {
        release()
    }
})

// Stop automation
router.post('/stop', async (req, res) => {
    const release = await automationMutex.acquire()

    try {
        if (!automationState.process) {
            return res.status(400).json(errorResponse(ErrorCodes.AUTOMATION_NOT_RUNNING, 'No automation running'))
        }

        automationState.status = 'stopping'
        broadcast({ type: 'status', status: 'stopping' })
        broadcast({ type: 'log', message: 'Stopping automation...', level: 'warn', source: 'server' })

        const pid = automationState.process.pid;

        // On Windows, we need to use taskkill to kill the process tree
        if (process.platform === 'win32' && pid) {
            await new Promise<void>((resolve) => {
                execFile('taskkill', ['/pid', String(pid), '/t', '/f'], (err) => {
                    if (err) {
                        console.error('[Taskkill Error]', err)
                    }
                    resolve()
                })
            })
        } else if (pid) {
            // On Linux, kill the entire process group using negative PID
            try {
                process.kill(-pid, 'SIGTERM')
            } catch {
                // Process group might not exist, try killing just the process
                automationState.process.kill('SIGTERM')
            }

            // Wait a bit then force kill if still running
            await new Promise((resolve) => setTimeout(resolve, 2000))

            try {
                process.kill(-pid, 'SIGKILL')
            } catch {
                // Already dead
            }
        }

        automationState.process = null

        automationState.status = 'idle'
        broadcast({ type: 'status', status: 'idle' })
        broadcast({ type: 'log', message: 'Automation stopped', level: 'info', source: 'server' })

        res.json({ success: true, message: 'Automation stopped' })
    } catch (error) {
        automationState.status = 'idle'
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    } finally {
        release()
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
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONPATH: PROJECT_ROOT },
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
