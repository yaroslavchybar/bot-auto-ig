import { Router } from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { automationState } from '../shared/store.js'
import { broadcast } from '../websocket.js'
import { profilesSetLoginTrue } from '../shared/convexClient.js'
import { automationMutex } from '../shared/mutex.js'
import { savePid, clearPid } from './process-manager.js'
import { errorResponse, ErrorCodes } from '../shared/errors.js'
import { validateSettings } from '../shared/settings-schema.js'
import { markStarted, markStopped } from './state.js'
import { parseLogOutput } from '../logs/parser.js'
import logger from '../shared/logger.js'
import { spawnPython, killByPid } from '../shared/ProcessService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// From dist/automation/ we need to go up to server/, then up to project root
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const PYTHON_RUNNER = path.join(PROJECT_ROOT, 'python', 'runners', 'run_multiple_accounts.py')
const LOGIN_SCRIPT = path.join(PROJECT_ROOT, 'python', 'actions', 'login', 'session.py')

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
        // -u flag disables output buffering so logs stream in real-time
        automationState.process = spawnPython({
            args: ['-u', PYTHON_RUNNER],
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

        let currentProfile: string | null = null;

        // Handle stdout - parse and format logs
        automationState.process.stdout?.on('data', (data) => {
            const raw = data.toString()
            const parsed = parseLogOutput(raw)

            for (const log of parsed) {
                if (log.eventType === 'profile_started') {
                    currentProfile = (log.metadata as any)?.profile || null;
                } else if (log.eventType === 'profile_completed') {
                    currentProfile = null;
                }

                logger.info({ source: 'python' }, log.message)
                broadcast({
                    type: log.eventType ? log.eventType : 'log',
                    message: log.message,
                    level: log.level,
                    source: 'python',
                    profileName: currentProfile,
                    ...log.metadata
                })
            }
        })

        // Handle stderr - parse and format as errors
        automationState.process.stderr?.on('data', (data) => {
            const raw = data.toString()
            const parsed = parseLogOutput(raw)

            for (const log of parsed) {
                logger.error({ source: 'python' }, log.message)
                broadcast({
                    type: 'log',
                    message: log.message,
                    level: log.explicitLevel ? log.level : 'error',
                    source: 'python'
                })
            }
        })

        // Handle process exit
        automationState.process.on('close', (code) => {
            logger.info({ code }, 'Python process exited')
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
            logger.error({ err }, 'Python process error')
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

        if (pid) {
            await killByPid(pid, automationState.process)
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

        const loginProcess = spawnPython({
            args,
            shell: true,
        })

        // Send credentials via stdin
        const credentials = JSON.stringify({
            username,
            password,
            two_factor_secret: twoFactorSecret || null
        })
        loginProcess.stdin?.write(credentials)
        loginProcess.stdin?.end()

        loginProcess.stdout?.on('data', (data) => {
            const message = data.toString().trim()
            if (message) {
                // Check for success signal
                if (message.includes('__LOGIN_SUCCESS__')) {
                    broadcast({ type: 'log', message: 'Login Successful', level: 'success', source: 'login', profileName })
                    // Auto-mark profile as logged in
                    profilesSetLoginTrue(profileName).catch(loginErr => {
                        logger.error({ err: loginErr, profileName }, 'Login auto-update error')
                    })
                }
                broadcast({ type: 'log', message, level: 'info', source: 'login', profileName })
            }
        })

        loginProcess.stderr?.on('data', (data) => {
            const message = data.toString().trim()
            if (message) {
                broadcast({ type: 'log', message, level: 'error', source: 'login', profileName })
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
