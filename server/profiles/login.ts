import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { broadcast } from '../websocket.js'
import { profilesSetLoginTrue } from '../shared/convexClient.js'
import logger from '../shared/logger.js'
import { spawnBun } from '../shared/ProcessService.js'
import type { ChildProcess } from '../shared/ProcessService.js'
import { asyncHandler } from '../shared/asyncHandler.js'
import { ValidationError } from '../shared/errors.js'
import { resolveProjectRoot } from '../shared/utils.js'

const PROJECT_ROOT = resolveProjectRoot(import.meta.url)
const LOGIN_SCRIPT = fs.existsSync(path.join(PROJECT_ROOT, 'server', 'browser', 'login.ts'))
    ? path.join(PROJECT_ROOT, 'server', 'browser', 'login.ts')
    : path.join(PROJECT_ROOT, 'server', 'dist', 'browser', 'login.js')

const router = Router()

// Start login automation
router.post('/', asyncHandler(async (req, res) => {
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

/** Spawn the Bun login process. */
function spawnLoginProcess(profileName: string, headless?: boolean): ChildProcess {
    const args = [LOGIN_SCRIPT, '--profile', profileName]
    if (headless) {
        args.push('--headless')
    }
    return spawnBun({ args })
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
    const successMarker = '__LOGIN_SUCCESS__'
    let successWindow = ''
    let loginRecorded = false

    proc.stdout?.on('data', (data) => {
        const raw = data.toString()
        const message = raw.trim()
        if (!message) return
        const combined = successWindow + raw
        if (!loginRecorded && combined.includes(successMarker)) {
            loginRecorded = true
            broadcast({ type: 'log', message: 'Login Successful', level: 'success', source: 'login', profileName })
            profilesSetLoginTrue(profileName).catch(loginErr => {
                logger.error({ err: loginErr, profileName }, 'Login auto-update error')
            })
        }
        successWindow = combined.slice(-(successMarker.length - 1))
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
