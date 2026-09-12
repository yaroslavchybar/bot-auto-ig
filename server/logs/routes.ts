
import { Router } from 'express'
import { logsStore } from '../shared/store.js'
import { clearLogs as clearMemoryLogs } from './store.js'

const router = Router()

// Get in-memory logs (never persisted to disk)
router.get('/', (_req, res) => {
    res.json(logsStore)
})

// Clear in-memory logs
router.delete('/', (_req, res) => {
    logsStore.length = 0
    clearMemoryLogs()
    res.json({ success: true })
})

export default router
