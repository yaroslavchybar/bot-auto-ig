import { Router } from 'express'
import { logsStore } from '../shared/store.js'

const router = Router()

// Get in-memory logs (never persisted to disk)
router.get('/', (_req, res) => {
    res.json(logsStore)
})

// Clear in-memory logs
router.delete('/', (_req, res) => {
    logsStore.length = 0

    res.json({ success: true })
})

export default router
