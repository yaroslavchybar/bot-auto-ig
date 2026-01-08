
import { Router } from 'express'
import { logsStore } from '../store.js'
import { clearLogs as clearFileLogs, getLogFiles, loadLogFile } from '../logs/store.js'

const router = Router()

// Get all stored logs
router.get('/', (req, res) => {
    res.json(logsStore)
})

router.get('/files', async (req, res) => {
    try {
        const files = await getLogFiles()
        res.json(files)
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

router.get('/file/:name', async (req, res) => {
    try {
        const { name } = req.params
        if (!name) {
            return res.status(400).json({ error: 'name is required' })
        }
        const entries = await loadLogFile(String(name))
        res.json(entries)
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

// Clear logs
router.delete('/', (req, res) => {
    logsStore.length = 0
    clearFileLogs()
    res.json({ success: true })
})

export default router
