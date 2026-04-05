import { Router } from 'express'
import path from 'path'
import { automationState } from '../shared/store.js'
import { broadcast } from '../websocket.js'
import { profilesSetLoginTrue } from '../shared/convexClient.js'
import { automationMutex } from '../shared/mutex.js'
import { savePid, clearPid } from './process-manager.js'
import { validateSettings } from '../shared/settings-schema.js'
import { markStarted, markStopped } from './state.js'
import { parseLogOutput } from '../logs/parser.js'
import logger from '../shared/logger.js'
import { spawnPython, killProcess } from '../shared/ProcessService.js'
import type { ChildProcess } from '../shared/ProcessService.js'
import { asyncHandler } from '../shared/asyncHandler.js'
import { ValidationError } from '../shared/errors.js'
import { resolveProjectRoot } from '../shared/utils.js'

const PROJECT_ROOT = resolveProjectRoot(import.meta.url)
const PYTHON_RUNNER = path.join(PROJECT_ROOT, 'python', 'runners', 'run_multiple_accounts.py')
const LOGIN_SCRIPT = path.join(PROJECT_ROOT, 'python', 'actions', 'login', 'session.py')

const router = Router()

// Get automation status
router.get('/status', (_req, res) => {
    res.json({
        status: automationState.status,
        running: automationState.status === 'running',
    })
})

// Start automation
router.post('/start', asyncHandler(async (req, res) => {
    const validationResult = validateSettings(req.body)
    if (validationResult instanceof Error) {
        throw new ValidationError(validationResult.message)
    }
    const settings = validationResult

    const release = await automationMutex.acquire()
    try {
        // Re-check state inside mutex to prevent race conditions
        if (automationState.process) {
            throw new ValidationError('Automation already running')
        }
        spawnAndWireAutomation(settings as Record<string, unknown>)
        res.json({ success: true, message: 'Automation started' })
    } finally {
        release()
    }
}))

// Stop automation
router.post('/stop', asyncHandler(async (_req, res) => {
    const release = await automationMutex.acquire()
    try {
        // Re-check state inside mutex to prevent race conditions
        if (!automationState.process) {
            throw new ValidationError('No automation running')
        }
        automationState.status = 'stopping'
        broadcast({ type: 'status', status: 'stopping' })
        broadcast({ type: 'log', message: 'Stopping automation...', level: 'warn', source: 'server' })

        await killProcess(automationState.process)

        automationState.process = null
        automationState.status = 'idle'
        broadcast({ type: 'status', status: 'idle' })
        broadcast({ type: 'log', message: 'Automation stopped', level: 'info', source: 'server' })

        res.json({ success: true, message: 'Automation stopped' })
    } finally {
        release()
    }
}))

// Start login automation
router.post('/login', asyncHandler(async (req, res) => {
    const { profileName, username, password, twoFactorSecret, headless } = req.body
    if (!profileName || !username || !password) {
        throw new ValidationError('profileName, username, and password are required')
    }

    broadcast({
        type: 'log',
        message: `Starting login for profile: ${profileName}`,
        level: 'info',
        source: 'server',
    })

    const loginProcess = spawnLoginProcess(profileName, headless)
    sendLoginCredentials(loginProcess, { username, password, twoFactorSecret })
    wireLoginEvents(loginProcess, profileName)

    res.json({ success: true, message: `Login started for ${profileName}` })
}))

// ---------------------------------------------------------------------------
// Helpers – automation start
// ---------------------------------------------------------------------------

/** Spawn the automation Python process and wire all I/O + lifecycle events. */
function spawnAndWireAutomation(settings: Record<string, unknown>): void {
    automationState.status = 'running'
    broadcast({ type: 'status', status: 'running' })
    broadcast({ type: 'log', message: 'Starting automation...', level: 'info', source: 'server' })

    automationState.process = spawnPython({ args: ['-u', PYTHON_RUNNER] })

    const payload = JSON.stringify({ settings })
    automationState.process.stdin?.write(payload)
    automationState.process.stdin?.end()

    if (automationState.process.pid) {
        savePid(automationState.process.pid)
        markStarted(automationState.process.pid, settings)
    }

    const currentProfile = { value: null as string | null }
    wireAutomationStdout(automationState.process, currentProfile)
    wireAutomationStderr(automationState.process)
    wireAutomationLifecycle(automationState.process)
}

/** Wire stdout events for the automation process. */
function wireAutomationStdout(
    proc: ChildProcess,
    currentProfile: { value: string | null },
): void {
    proc.stdout?.on('data', (data) => {
        const parsed = parseLogOutput(data.toString())
        for (const log of parsed) {
            if (log.eventType === 'profile_started') {
                currentProfile.value = (log.metadata as any)?.profile || null
            } else if (log.eventType === 'profile_completed') {
                currentProfile.value = null
            }
            logger.info({ source: 'python' }, log.message)
            broadcast({
                type: log.eventType ? log.eventType : 'log',
                message: log.message,
                level: log.level,
                source: 'python',
                profileName: currentProfile.value,
                ...log.metadata,
            })
        }
    })
}

/** Wire stderr events for the automation process. */
function wireAutomationStderr(proc: ChildProcess): void {
    proc.stderr?.on('data', (data) => {
        const parsed = parseLogOutput(data.toString())
        for (const log of parsed) {
            logger.error({ source: 'python' }, log.message)
            broadcast({
                type: 'log',
                message: log.message,
                level: log.explicitLevel ? log.level : 'error',
                source: 'python',
            })
        }
    })
}

/** Wire close/error lifecycle events for the automation process. */
function wireAutomationLifecycle(proc: ChildProcess): void {
    proc.on('close', (code) => {
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

    proc.on('error', (err) => {
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
}

// ---------------------------------------------------------------------------
// Helpers – login
// ---------------------------------------------------------------------------

/** Spawn the login Python process. */
function spawnLoginProcess(profileName: string, headless?: boolean): ChildProcess {
    const args = [LOGIN_SCRIPT, '--profile', profileName]
    if (headless) {
        args.push('--headless')
    }
    return spawnPython({ args })
}

/** Send login credentials via stdin. */
function sendLoginCredentials(
    proc: ChildProcess,
    creds: { username: string; password: string; twoFactorSecret?: string },
): void {
    const payload = JSON.stringify({
        username: creds.username,
        password: creds.password,
        two_factor_secret: creds.twoFactorSecret || null,
    })
    proc.stdin?.write(payload)
    proc.stdin?.end()
}

/** Wire stdout/stderr/close events for the login process. */
function wireLoginEvents(proc: ChildProcess, profileName: string): void {
    proc.stdout?.on('data', (data) => {
        const message = data.toString().trim()
        if (!message) return
        if (message.includes('__LOGIN_SUCCESS__')) {
            broadcast({ type: 'log', message: 'Login Successful', level: 'success', source: 'login', profileName })
            profilesSetLoginTrue(profileName).catch(loginErr => {
                logger.error({ err: loginErr, profileName }, 'Login auto-update error')
            })
        }
        broadcast({ type: 'log', message, level: 'info', source: 'login', profileName })
    })

    proc.stderr?.on('data', (data) => {
        const message = data.toString().trim()
        if (message) {
            broadcast({ type: 'log', message, level: 'error', source: 'login', profileName })
        }
    })

    proc.on('close', (code) => {
        broadcast({
            type: 'log',
            message: `Login process finished with code ${code}`,
            level: code === 0 ? 'success' : 'warn',
            source: 'server',
        })
    })
}

export default router
