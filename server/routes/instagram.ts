
import { Router } from 'express'
import { instagramSettingsGet, instagramSettingsUpsert } from '../lib/convex.js'

const router = Router()

// Get Instagram settings
router.get('/settings', async (req, res) => {
    try {
        const scope = (req.query.scope as string) || 'global'
        const settings = await instagramSettingsGet(scope)
        res.json(settings || {})
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

// Update Instagram settings
router.post('/settings', async (req, res) => {
    try {
        const { scope = 'global', ...data } = req.body
        const result = await instagramSettingsUpsert(scope, data)
        res.json(result || {})
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

export default router
