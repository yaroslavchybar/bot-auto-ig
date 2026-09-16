import { Router } from 'express'
import { activeDisplays } from '../shared/store.js'
import uploadsRouter from './uploads.js'
import clipboardRouter from './clipboard.js'

const router = Router()

router.use('/uploads', uploadsRouter)
router.use(clipboardRouter)

router.get('/', (_req, res) => {
    const sorted = Array.from(activeDisplays.values())
        .sort((a, b) => {
            if (a.workflowId !== b.workflowId) return a.workflowId.localeCompare(b.workflowId)
            return a.profileName.localeCompare(b.profileName)
        })
    res.json(sorted)
})

export default router
