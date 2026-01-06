
import { Router } from 'express'
import { spawn, execFile } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { profileManager } from '../lib/profiles.js'
import {
    profilesListAssigned,
    profilesListUnassigned,
    profilesBulkSetListId,
    profilesSyncStatus,
    profilesSetLoginTrue
} from '../lib/convex.js'
import { profileProcesses } from '../store.js'
import { broadcast } from '../websocket.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const LAUNCHER_SCRIPT = path.join(PROJECT_ROOT, 'python', 'launcher.py')

const router = Router()

// Get all profiles
router.get('/', async (req, res) => {
    try {
        const profiles = await profileManager.getProfiles()
        res.json(profiles)
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

// Create a profile
router.post('/', async (req, res) => {
    try {
        const profile = req.body
        if (!profile.name) {
            return res.status(400).json({ error: 'name is required' })
        }
        const success = await profileManager.createProfile(profile)
        if (success) {
            res.json({ success: true })
        } else {
            res.status(500).json({ error: 'Failed to create profile' })
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

// Update a profile
router.put('/:name', async (req, res) => {
    try {
        const oldName = req.params.name
        const profile = req.body
        if (!profile.name) {
            return res.status(400).json({ error: 'name is required' })
        }
        const success = await profileManager.updateProfile(oldName, profile)
        if (success) {
            res.json({ success: true })
        } else {
            res.status(500).json({ error: 'Failed to update profile' })
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

// Delete a profile
router.delete('/:name', async (req, res) => {
    try {
        const name = req.params.name
        const success = await profileManager.deleteProfile(name)
        if (success) {
            res.json({ success: true })
        } else {
            res.status(500).json({ error: 'Failed to delete profile' })
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

// Start profile browser (manual browser control)
router.post('/:name/start', async (req, res) => {
    const { name } = req.params

    if (profileProcesses.has(name)) {
        return res.status(400).json({ error: 'Profile browser already running' })
    }

    try {
        // Get profile to access proxy and user agent settings
        const profiles = await profileManager.getProfiles()
        const profile = profiles.find((p) => p.name === name)

        if (!profile) {
            return res.status(404).json({ error: 'Profile not found' })
        }

        const python = process.env.PYTHON || 'python'
        const args = [LAUNCHER_SCRIPT, '--name', name, '--action', 'manual']

        if (profile.proxy) {
            args.push('--proxy', profile.proxy)
        }
        if (profile.user_agent) {
            args.push('--user-agent', profile.user_agent)
        }

        broadcast({
            type: 'log',
            message: `Starting browser for profile: ${name}`,
            level: 'info',
            source: 'server',
        })

        const child = spawn(python, args, {
            cwd: PROJECT_ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: process.platform === 'win32',
            env: { ...process.env, PYTHONUNBUFFERED: '1' },
        })

        child.stdout?.on('data', (data) => {
            const message = data.toString().trim()
            if (message) {
                broadcast({ type: 'log', message, level: 'info', source: `profile:${name}` })
            }
        })

        child.stderr?.on('data', (data) => {
            const message = data.toString().trim()
            if (message) {
                broadcast({ type: 'log', message, level: 'error', source: `profile:${name}` })
            }
        })

        child.on('exit', (code) => {
            profileProcesses.delete(name)
            void profilesSyncStatus(name, 'idle', false)
            broadcast({
                type: 'log',
                message: `Browser closed for profile: ${name} (code: ${code})`,
                level: 'info',
                source: 'server',
            })
        })

        child.on('error', (err) => {
            profileProcesses.delete(name)
            void profilesSyncStatus(name, 'idle', false)
            broadcast({
                type: 'log',
                message: `Browser error for profile ${name}: ${err.message}`,
                level: 'error',
                source: 'server',
            })
        })

        profileProcesses.set(name, child)
        void profilesSyncStatus(name, 'running', true)

        res.json({ success: true, message: `Browser started for ${name}` })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

// Stop profile browser
router.post('/:name/stop', async (req, res) => {
    const { name } = req.params
    const proc = profileProcesses.get(name)

    if (!proc) {
        return res.status(400).json({ error: 'No browser running for this profile' })
    }

    try {
        broadcast({
            type: 'log',
            message: `Stopping browser for profile: ${name}`,
            level: 'warn',
            source: 'server',
        })

        // Windows needs taskkill to kill process tree
        if (process.platform === 'win32' && proc.pid) {
            await new Promise<void>((resolve) => {
                execFile('taskkill', ['/pid', String(proc.pid), '/t', '/f'], (err) => {
                    if (err) console.error('[Taskkill Error]', err)
                    resolve()
                })
            })
        } else {
            proc.kill('SIGTERM')
            // Force kill after 2 seconds if still running
            setTimeout(() => {
                if (proc.exitCode === null) {
                    proc.kill('SIGKILL')
                }
            }, 2000)
        }

        profileProcesses.delete(name)
        await profilesSyncStatus(name, 'idle', false)

        res.json({ success: true, message: `Browser stopped for ${name}` })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

router.post('/sync-status', async (req, res) => {
    try {
        const { name, status, using } = req.body || {}
        if (!name || !status) {
            return res.status(400).json({ error: 'name and status are required' })
        }
        await profilesSyncStatus(String(name), String(status), Boolean(using))
        res.json({ success: true })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

router.post('/set-login-true', async (req, res) => {
    try {
        const { name } = req.body || {}
        if (!name) {
            return res.status(400).json({ error: 'name is required' })
        }
        await profilesSetLoginTrue(String(name))
        res.json({ success: true })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

router.get('/assigned', async (req, res) => {
    try {
        const listId = String(req.query.list_id || '').trim()
        if (!listId) {
            return res.status(400).json({ error: 'list_id is required' })
        }
        const rows = await profilesListAssigned(listId)
        res.json(rows || [])
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

router.get('/unassigned', async (_req, res) => {
    try {
        const rows = await profilesListUnassigned()
        res.json(rows || [])
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

router.post('/bulk-set-list-id', async (req, res) => {
    try {
        const { profileIds, listId } = req.body || {}
        if (!Array.isArray(profileIds)) {
            return res.status(400).json({ error: 'profileIds must be an array' })
        }
        await profilesBulkSetListId(profileIds, listId ?? null)
        res.json({ success: true })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

export default router
