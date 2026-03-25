
import { Router } from 'express'
import { logsStore } from '../shared/store.js'
import { clearLogs as clearFileLogs, getLogFiles, loadLogFile } from './store.js'
import { asyncHandler } from '../shared/asyncHandler.js'
import { ValidationError } from '../shared/errors.js'

const router = Router()

// Get all stored logs
router.get('/', (_req, res) => {
    res.json(logsStore)
})

router.get('/files', asyncHandler(async (_req, res) => {
    const files = await getLogFiles()
    res.json(files)
}))

router.get('/file/:name', asyncHandler(async (req, res) => {
    const { name } = req.params
    if (!name) {
        throw new ValidationError('name is required')
    }
    const entries = await loadLogFile(String(name))
    res.json(entries)
}))

// Clear logs
router.delete('/', (_req, res) => {
    logsStore.length = 0
    clearFileLogs()
    res.json({ success: true })
})

export default router
